"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The single-flight sender.
 *
 * One request in flight at a time, which is the whole rate policy and also
 * what guarantees per-alert ordering. Nothing is queued: each time it is free,
 * the sender asks the reconciler for the next action. During an outage it
 * therefore sends the *current* desired state when PagerDuty answers again,
 * and a condition that started and ended in between sends nothing.
 *
 * Backoff is shared because there is one endpoint. An outage warns once, warns
 * again at most hourly, and logs one recovery line.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sender = void 0;
exports.equalJitterDelayMs = equalJitterDelayMs;
const settings_1 = require("../settings");
const errors_1 = require("../utils/errors");
const redact_1 = require("../utils/redact");
const retry_after_1 = require("../utils/retry-after");
const timing_1 = require("../utils/timing");
const events_1 = require("./events");
/** Equal jitter: at least half the window, so a `429` never retries at once. */
function equalJitterDelayMs(input) {
    const exponent = Math.min(Math.max(input.attempt - 1, 0), 16);
    const ceiling = Math.min(input.maxMs, input.baseMs * 2 ** exponent);
    return Math.round(ceiling / 2 + input.random() * (ceiling / 2));
}
/** Sends one action at a time until the reconciler has nothing left. */
class Sender {
    deps;
    now;
    random;
    sleep;
    running = false;
    pending = false;
    stopped = false;
    backoff;
    failures = 0;
    outageSince = null;
    lastOutageWarnAt = 0;
    attemptedDuringOutage = new Set();
    loop = Promise.resolve();
    constructor(deps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
        this.random = deps.random ?? Math.random;
        this.sleep = deps.sleep ?? timing_1.interruptibleSleep;
    }
    /** True between the first failed attempt and the next answer from PagerDuty. */
    get inOutage() {
        return this.outageSince !== null;
    }
    /** Something may have changed. Never cuts a backoff short. */
    wake() {
        if (this.stopped) {
            return;
        }
        this.pending = true;
        if (!this.running) {
            this.running = true;
            this.loop = this.run();
        }
    }
    /** Stop sending. An in-flight request is left to finish; nothing new starts. */
    async stop() {
        this.stopped = true;
        this.backoff?.interrupt();
        await this.loop;
    }
    async run() {
        try {
            while (!this.stopped) {
                this.pending = false;
                const action = this.deps.nextAction();
                if (action === undefined) {
                    if (!this.pending) {
                        break;
                    }
                    continue;
                }
                const delayMs = await this.attempt(action);
                if (delayMs > 0 && !this.stopped) {
                    this.backoff = this.sleep(delayMs);
                    await this.backoff.promise;
                    this.backoff = undefined;
                }
            }
        }
        catch (error) {
            this.deps.log.error(`sender stopped unexpectedly: ${(0, errors_1.describeError)(error)}`);
        }
        finally {
            this.running = false;
        }
    }
    /** Send one action and return how long to wait before the next. */
    async attempt(action) {
        const started = this.now();
        let response;
        try {
            response = await this.deps.post(action);
        }
        catch (error) {
            this.deps.onRequest?.(this.now() - started, false);
            return this.failed(action, { detail: (0, errors_1.describeError)(error), rateLimited: false });
        }
        const outcome = (0, events_1.classifyStatus)(response.status);
        this.deps.onRequest?.(this.now() - started, outcome === 'delivered');
        switch (outcome) {
            case 'delivered':
                this.recovered();
                this.deps.onDelivered(action);
                this.logDelivered(action, response.status);
                return 0;
            case 'rejected':
                this.recovered();
                this.deps.onRejected(action, (0, events_1.rejectionReason)(response.status, response.body));
                return 0;
            case 'rateLimited':
                return this.failed(action, {
                    detail: `HTTP ${response.status}`,
                    rateLimited: true,
                    retryAfterMs: (0, retry_after_1.parseRetryAfterMs)(response.headers['retry-after'], settings_1.MAX_RETRY_AFTER_MS, this.now),
                });
            default:
                return this.failed(action, { detail: `HTTP ${response.status}`, rateLimited: false });
        }
    }
    logDelivered(action, status) {
        const what = action.kind === 'trigger' ? `trigger sent (${action.severity})` : 'resolve sent';
        this.deps.log.info(`${(0, redact_1.forLog)(action.label)}: ${what}`);
        if (status !== 202) {
            this.deps.log.warn(`PagerDuty answered ${status} rather than 202; treated as accepted`);
        }
    }
    failed(action, failure) {
        this.failures += 1;
        if (action.kind === 'trigger') {
            this.attemptedDuringOutage.add(action.key);
        }
        const delayMs = failure.rateLimited
            ? Math.max(failure.retryAfterMs ?? 0, equalJitterDelayMs({
                attempt: this.failures,
                baseMs: settings_1.RATE_LIMIT_BACKOFF_BASE_MS,
                maxMs: settings_1.BACKOFF_MAX_MS,
                random: this.random,
            }))
            : (0, timing_1.backoffDelayMs)({ attempt: this.failures, baseMs: settings_1.BACKOFF_BASE_MS, maxMs: settings_1.BACKOFF_MAX_MS, random: this.random });
        const now = this.now();
        const what = failure.rateLimited ? 'is rate limiting events' : 'is not reachable';
        const line = `PagerDuty ${what} (${failure.detail}); retrying in ${Math.round(delayMs / 1_000)}s`;
        if (this.outageSince === null || now - this.lastOutageWarnAt >= settings_1.OUTAGE_REWARN_MS) {
            this.outageSince ??= now;
            this.lastOutageWarnAt = now;
            this.deps.log.warn(line);
        }
        else {
            this.deps.log.debug(line);
        }
        return delayMs;
    }
    recovered() {
        this.failures = 0;
        if (this.outageSince === null) {
            return;
        }
        const minutes = Math.max(1, Math.round((this.now() - this.outageSince) / 60_000));
        const superseded = this.deps.countSuperseded(this.attemptedDuringOutage);
        const tail = superseded > 0
            ? `; ${superseded} alert(s) opened and closed while unreachable, not sent`
            : '';
        this.deps.log.info(`PagerDuty recovered after ${minutes} min${tail}`);
        this.outageSince = null;
        this.lastOutageWarnAt = 0;
        this.attemptedDuringOutage.clear();
    }
}
exports.Sender = Sender;
