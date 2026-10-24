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

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_RETRY_AFTER_MS,
  OUTAGE_REWARN_MS,
  RATE_LIMIT_BACKOFF_BASE_MS,
} from '../settings'
import type { Action } from '../state/reconcile'
import type { PluginLogger } from '../types'
import { describeError } from '../utils/errors'
import { forLog } from '../utils/redact'
import { parseRetryAfterMs } from '../utils/retry-after'
import { backoffDelayMs, interruptibleSleep, type InterruptibleSleep } from '../utils/timing'
import { classifyStatus, rejectionReason } from './events'
import type { HttpResponse } from './http'

/** What the sender needs from the controller. */
export interface SenderDeps {
  /** The next sendable action, or undefined when there is nothing to do. */
  nextAction: () => Action | undefined
  /** Send one action. Builds the body; the sender never sees the routing key. */
  post: (action: Action) => Promise<HttpResponse>
  /** PagerDuty accepted exactly this action. Record what was sent. */
  onDelivered: (action: Action) => void
  /** PagerDuty refused this action with a `4xx`. */
  onRejected: (action: Action, reason: string) => void
  /** Of these target keys, how many opened and closed again unsent. */
  countSuperseded: (keys: ReadonlySet<string>) => number
  /** One request finished, for diagnostics. */
  onRequest?: (durationMs: number, ok: boolean) => void
  log: PluginLogger
  now?: () => number
  random?: () => number
  sleep?: (ms: number) => InterruptibleSleep
}

/** Equal jitter: at least half the window, so a `429` never retries at once. */
export function equalJitterDelayMs(input: {
  attempt: number
  baseMs: number
  maxMs: number
  random: () => number
}): number {
  const exponent = Math.min(Math.max(input.attempt - 1, 0), 16)
  const ceiling = Math.min(input.maxMs, input.baseMs * 2 ** exponent)
  return Math.round(ceiling / 2 + input.random() * (ceiling / 2))
}

/** Sends one action at a time until the reconciler has nothing left. */
export class Sender {
  private readonly deps: SenderDeps
  private readonly now: () => number
  private readonly random: () => number
  private readonly sleep: (ms: number) => InterruptibleSleep
  private running = false
  private pending = false
  private stopped = false
  private backoff: InterruptibleSleep | undefined
  private failures = 0
  private outageSince: number | null = null
  private lastOutageWarnAt = 0
  private readonly attemptedDuringOutage = new Set<string>()
  private loop: Promise<void> = Promise.resolve()

  constructor(deps: SenderDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.sleep = deps.sleep ?? interruptibleSleep
  }

  /** True between the first failed attempt and the next answer from PagerDuty. */
  get inOutage(): boolean {
    return this.outageSince !== null
  }

  /** Something may have changed. Never cuts a backoff short. */
  wake(): void {
    if (this.stopped) {
      return
    }
    this.pending = true
    if (!this.running) {
      this.running = true
      this.loop = this.run()
    }
  }

  /** Stop sending. An in-flight request is left to finish; nothing new starts. */
  async stop(): Promise<void> {
    this.stopped = true
    this.backoff?.interrupt()
    await this.loop
  }

  private async run(): Promise<void> {
    try {
      while (!this.stopped) {
        this.pending = false
        const action = this.deps.nextAction()
        if (action === undefined) {
          if (!this.pending) {
            break
          }
          continue
        }
        const delayMs = await this.attempt(action)
        if (delayMs > 0 && !this.stopped) {
          this.backoff = this.sleep(delayMs)
          await this.backoff.promise
          this.backoff = undefined
        }
      }
    } catch (error) {
      this.deps.log.error(`sender stopped unexpectedly: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /** Send one action and return how long to wait before the next. */
  private async attempt(action: Action): Promise<number> {
    const started = this.now()
    let response: HttpResponse
    try {
      response = await this.deps.post(action)
    } catch (error) {
      this.deps.onRequest?.(this.now() - started, false)
      return this.failed(action, { detail: describeError(error), rateLimited: false })
    }
    const outcome = classifyStatus(response.status)
    this.deps.onRequest?.(this.now() - started, outcome === 'delivered')
    switch (outcome) {
      case 'delivered':
        this.recovered()
        this.deps.onDelivered(action)
        this.logDelivered(action, response.status)
        return 0
      case 'rejected':
        this.recovered()
        this.deps.onRejected(action, rejectionReason(response.status, response.body))
        return 0
      case 'rateLimited':
        return this.failed(action, {
          detail: `HTTP ${response.status}`,
          rateLimited: true,
          retryAfterMs: parseRetryAfterMs(response.headers['retry-after'], MAX_RETRY_AFTER_MS, this.now),
        })
      default:
        return this.failed(action, { detail: `HTTP ${response.status}`, rateLimited: false })
    }
  }

  private logDelivered(action: Action, status: number): void {
    const what = action.kind === 'trigger' ? `trigger sent (${action.severity})` : 'resolve sent'
    this.deps.log.info(`${forLog(action.label)}: ${what}`)
    if (status !== 202) {
      this.deps.log.warn(`PagerDuty answered ${status} rather than 202; treated as accepted`)
    }
  }

  private failed(action: Action, failure: { detail: string; rateLimited: boolean; retryAfterMs?: number }): number {
    this.failures += 1
    if (action.kind === 'trigger') {
      this.attemptedDuringOutage.add(action.key)
    }
    const delayMs = failure.rateLimited
      ? Math.max(failure.retryAfterMs ?? 0, equalJitterDelayMs({
        attempt: this.failures,
        baseMs: RATE_LIMIT_BACKOFF_BASE_MS,
        maxMs: BACKOFF_MAX_MS,
        random: this.random,
      }))
      : backoffDelayMs({ attempt: this.failures, baseMs: BACKOFF_BASE_MS, maxMs: BACKOFF_MAX_MS, random: this.random })
    const now = this.now()
    const what = failure.rateLimited ? 'is rate limiting events' : 'is not reachable'
    const line = `PagerDuty ${what} (${failure.detail}); retrying in ${Math.round(delayMs / 1_000)}s`
    if (this.outageSince === null || now - this.lastOutageWarnAt >= OUTAGE_REWARN_MS) {
      this.outageSince ??= now
      this.lastOutageWarnAt = now
      this.deps.log.warn(line)
    } else {
      this.deps.log.debug(line)
    }
    return delayMs
  }

  private recovered(): void {
    this.failures = 0
    if (this.outageSince === null) {
      return
    }
    const minutes = Math.max(1, Math.round((this.now() - this.outageSince) / 60_000))
    const superseded = this.deps.countSuperseded(this.attemptedDuringOutage)
    const tail = superseded > 0
      ? `; ${superseded} alert(s) opened and closed while unreachable, not sent`
      : ''
    this.deps.log.info(`PagerDuty recovered after ${minutes} min${tail}`)
    this.outageSince = null
    this.lastOutageWarnAt = 0
    this.attemptedDuringOutage.clear()
  }
}
