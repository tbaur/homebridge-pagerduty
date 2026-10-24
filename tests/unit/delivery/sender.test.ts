/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The sender's whole rate policy is "one at a time, back off together". These
 * tests drive it against each class of answer PagerDuty can give, and pin the
 * log lines a user sees during an outage: one warning, one recovery.
 */

import type { HttpResponse } from '../../../src/delivery/http'
import { equalJitterDelayMs, Sender, type SenderDeps } from '../../../src/delivery/sender'
import type { Action, TriggerAction } from '../../../src/state/reconcile'
import { fakeLogger, type RecordingLogger } from '../../helpers/hap'
import { ManualSleeps } from '../../helpers/sleeps'
import { accepted, settle, status } from '../../helpers/transport'

function trigger(key: string): TriggerAction {
  return {
    kind: 'trigger',
    key,
    label: key,
    dedupKey: `homebridge/${key}`,
    severity: 'critical',
    summary: 's',
    timestamp: 1,
    details: { component: key, group: 'g', custom: {} },
    hash: key,
  }
}

interface Harness {
  sender: Sender
  log: RecordingLogger
  sleeps: ManualSleeps
  queue: Action[]
  delivered: string[]
  rejected: string[]
  requests: boolean[]
  answers: (HttpResponse | Error)[]
  clock: { now: number }
  superseded: { keys: string[][]; count: number }
}

function harness(overrides: Partial<SenderDeps> = {}): Harness {
  const log = fakeLogger()
  const sleeps = new ManualSleeps()
  const clock = { now: 0 }
  const h: Harness = {
    log,
    sleeps,
    clock,
    queue: [],
    delivered: [],
    rejected: [],
    requests: [],
    answers: [],
    superseded: { keys: [], count: 0 },
    sender: undefined as unknown as Sender,
  }
  h.sender = new Sender({
    nextAction: () => h.queue[0],
    post: () => {
      const answer = h.answers.shift() ?? accepted()
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
    onDelivered: (action) => {
      h.delivered.push(action.key)
      h.queue.shift()
    },
    onRejected: (action, reason) => {
      h.rejected.push(`${action.key} ${reason}`)
      h.queue.shift()
    },
    countSuperseded: (keys) => {
      h.superseded.keys.push([...keys])
      return h.superseded.count
    },
    onRequest: (_duration, ok) => h.requests.push(ok),
    log,
    now: () => clock.now,
    random: () => 0.5,
    sleep: sleeps.sleep,
    ...overrides,
  })
  return h
}

describe('Sender', () => {
  it('sends everything the reconciler offers, one at a time, then idles', async () => {
    const h = harness()
    h.queue.push(trigger('a'), trigger('b'))

    h.sender.wake()
    await settle()

    expect(h.delivered).toEqual(['a', 'b'])
    expect(h.requests).toEqual([true, true])
    expect(h.log.lines('info')).toEqual(['a: trigger sent (critical)', 'b: trigger sent (critical)'])
    expect(h.sleeps.delays).toEqual([])
  })

  it('logs a resolve as such', async () => {
    const h = harness()
    h.queue.push({ kind: 'resolve', key: 'a', label: 'Leak', dedupKey: 'x', hash: 'h' })

    h.sender.wake()
    await settle()

    expect(h.log.lines('info')).toEqual(['Leak: resolve sent'])
  })

  it('accepts a 2xx that is not 202, with a warning', async () => {
    const h = harness()
    h.queue.push(trigger('a'))
    h.answers.push(status(200))

    h.sender.wake()
    await settle()

    expect(h.delivered).toEqual(['a'])
    expect(h.log.lines('warn')).toEqual(['PagerDuty answered 200 rather than 202; treated as accepted'])
  })

  it('records a 400 as rejected and moves on without waiting', async () => {
    const h = harness()
    h.queue.push(trigger('a'), trigger('b'))
    h.answers.push(status(400, '{"message":"Event object is invalid"}'))

    h.sender.wake()
    await settle()

    expect(h.rejected).toEqual(['a HTTP 400: Event object is invalid'])
    expect(h.delivered).toEqual(['b'])
    expect(h.sleeps.delays).toEqual([])
  })

  it('backs off with full jitter on a 5xx, warns once, and logs one recovery line', async () => {
    const h = harness()
    h.queue.push(trigger('a'))
    h.answers.push(status(503), status(502))

    h.sender.wake()
    await settle()
    expect(h.sleeps.delays).toEqual([2_500])
    expect(h.sender.inOutage).toBe(true)
    expect(h.log.lines('warn')).toEqual(['PagerDuty is not reachable (HTTP 503); retrying in 3s'])

    h.clock.now = 60_000
    h.sleeps.releaseNext()
    await settle()
    expect(h.sleeps.delays).toEqual([2_500, 5_000])
    expect(h.log.lines('warn')).toHaveLength(1)
    expect(h.log.lines('debug')).toEqual(['PagerDuty is not reachable (HTTP 502); retrying in 5s'])

    h.clock.now = 180_000
    h.sleeps.releaseNext()
    await settle()
    expect(h.delivered).toEqual(['a'])
    expect(h.sender.inOutage).toBe(false)
    expect(h.log.lines('info')).toEqual(['PagerDuty recovered after 3 min', 'a: trigger sent (critical)'])
    expect(h.superseded.keys).toEqual([['a']])
  })

  it('names alerts that opened and closed unsent in the recovery line', async () => {
    const h = harness()
    h.superseded.count = 2
    h.queue.push(trigger('a'))
    h.answers.push(new Error('socket hang up'))

    h.sender.wake()
    await settle()
    h.sleeps.releaseNext()
    await settle()

    expect(h.requests).toEqual([false, true])
    expect(h.log.lines('info')[0]).toBe('PagerDuty recovered after 1 min; 2 alert(s) opened and closed while unreachable, not sent')
  })

  it('warns again at most hourly during a long outage', async () => {
    const h = harness()
    h.queue.push(trigger('a'))
    h.answers.push(status(500), status(500), status(500))

    h.sender.wake()
    await settle()
    h.clock.now = 30 * 60_000
    h.sleeps.releaseNext()
    await settle()
    h.clock.now = 61 * 60_000
    h.sleeps.releaseNext()
    await settle()

    expect(h.log.lines('warn')).toHaveLength(2)
    expect(h.log.lines('debug')).toHaveLength(1)
  })

  it('waits at least half the rate-limit window on a 429, and longer when Retry-After asks', async () => {
    const h = harness({ random: () => 0 })
    h.queue.push(trigger('a'))
    h.answers.push(status(429), status(429, '', { 'retry-after': '120' }))

    h.sender.wake()
    await settle()
    h.sleeps.releaseNext()
    await settle()

    expect(h.sleeps.delays).toEqual([30_000, 120_000])
    expect(h.log.lines('warn')[0]).toBe('PagerDuty is rate limiting events (HTTP 429); retrying in 30s')
  })

  it('treats a resolve that fails as an outage but not as a superseded trigger', async () => {
    const h = harness()
    h.queue.push({ kind: 'resolve', key: 'a', label: 'a', dedupKey: 'x', hash: 'h' })
    h.answers.push(status(500))

    h.sender.wake()
    await settle()
    h.sleeps.releaseNext()
    await settle()

    expect(h.superseded.keys).toEqual([[]])
  })

  it('does not start a second loop when woken mid-flight, but does re-check afterwards', async () => {
    const h = harness()
    let release: (answer: HttpResponse) => void = () => undefined
    const posts: string[] = []
    const sender = new Sender({
      nextAction: () => h.queue[0],
      post: (action) => {
        posts.push(action.key)
        return new Promise((resolve) => {
          release = resolve
        })
      },
      onDelivered: () => {
        h.queue.shift()
      },
      onRejected: () => undefined,
      countSuperseded: () => 0,
      log: h.log,
      sleep: h.sleeps.sleep,
    })
    h.queue.push(trigger('a'))
    sender.wake()
    await settle()
    h.queue.push(trigger('b'))
    sender.wake()
    await settle()
    expect(posts).toEqual(['a'])

    release(accepted())
    await settle()
    release(accepted())
    await settle()

    expect(posts).toEqual(['a', 'b'])
    expect(h.queue).toEqual([])
  })

  it('goes round again when woken while the reconciler had nothing', async () => {
    const h = harness()
    let calls = 0
    const sender = new Sender({
      nextAction: () => {
        calls += 1
        if (calls === 1) {
          sender.wake()
        }
        return undefined
      },
      post: () => Promise.resolve(accepted()),
      onDelivered: () => undefined,
      onRejected: () => undefined,
      countSuperseded: () => 0,
      log: h.log,
    })

    sender.wake()
    await settle()

    expect(calls).toBe(2)
  })

  it('stops promptly, cutting a backoff short, and ignores later wakes', async () => {
    const h = harness()
    h.queue.push(trigger('a'))
    h.answers.push(status(500))
    h.sender.wake()
    await settle()

    await h.sender.stop()
    h.sender.wake()
    await settle()

    expect(h.requests).toEqual([false])
  })

  it('logs and stops if the reconciler throws', async () => {
    const h = harness({ nextAction: () => { throw new Error('boom') } })

    h.sender.wake()
    await settle()

    expect(h.log.lines('error')).toEqual(['sender stopped unexpectedly: boom'])
  })

  it('uses the real clock, randomness and sleep by default', async () => {
    const log = fakeLogger()
    const sender = new Sender({
      nextAction: () => undefined,
      post: () => Promise.resolve(accepted()),
      onDelivered: () => undefined,
      onRejected: () => undefined,
      countSuperseded: () => 0,
      log,
    })

    sender.wake()
    await sender.stop()

    expect(log.calls).toEqual([])
  })
})

describe('equalJitterDelayMs', () => {
  it('stays between half and all of the window, and doubles to the cap', () => {
    const at = (attempt: number, random: number): number => equalJitterDelayMs({ attempt, baseMs: 60_000, maxMs: 300_000, random: () => random })

    expect(at(1, 0)).toBe(30_000)
    expect(at(1, 1)).toBe(60_000)
    expect(at(2, 0)).toBe(60_000)
    expect(at(10, 1)).toBe(300_000)
    expect(at(0, 0)).toBe(30_000)
  })
})
