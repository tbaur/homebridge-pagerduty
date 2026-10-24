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
import type { Action } from '../state/reconcile';
import type { PluginLogger } from '../types';
import { type InterruptibleSleep } from '../utils/timing';
import type { HttpResponse } from './http';
/** What the sender needs from the controller. */
export interface SenderDeps {
    /** The next sendable action, or undefined when there is nothing to do. */
    nextAction: () => Action | undefined;
    /** Send one action. Builds the body; the sender never sees the routing key. */
    post: (action: Action) => Promise<HttpResponse>;
    /** PagerDuty accepted exactly this action. Record what was sent. */
    onDelivered: (action: Action) => void;
    /** PagerDuty refused this action with a `4xx`. */
    onRejected: (action: Action, reason: string) => void;
    /** Of these target keys, how many opened and closed again unsent. */
    countSuperseded: (keys: ReadonlySet<string>) => number;
    /** One request finished, for diagnostics. */
    onRequest?: (durationMs: number, ok: boolean) => void;
    log: PluginLogger;
    now?: () => number;
    random?: () => number;
    sleep?: (ms: number) => InterruptibleSleep;
}
/** Equal jitter: at least half the window, so a `429` never retries at once. */
export declare function equalJitterDelayMs(input: {
    attempt: number;
    baseMs: number;
    maxMs: number;
    random: () => number;
}): number;
/** Sends one action at a time until the reconciler has nothing left. */
export declare class Sender {
    private readonly deps;
    private readonly now;
    private readonly random;
    private readonly sleep;
    private running;
    private pending;
    private stopped;
    private backoff;
    private failures;
    private outageSince;
    private lastOutageWarnAt;
    private readonly attemptedDuringOutage;
    private loop;
    constructor(deps: SenderDeps);
    /** True between the first failed attempt and the next answer from PagerDuty. */
    get inOutage(): boolean;
    /** Something may have changed. Never cuts a backoff short. */
    wake(): void;
    /** Stop sending. An in-flight request is left to finish; nothing new starts. */
    stop(): Promise<void>;
    private run;
    /** Send one action and return how long to wait before the next. */
    private attempt;
    private logDelivered;
    private failed;
    private recovered;
}
