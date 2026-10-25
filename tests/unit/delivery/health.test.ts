/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The delivery sensor is the one channel left when paging itself is broken.
 * It must open for a real outage and stay shut for maintenance and for a
 * single slow request.
 */

import { DeliveryHealth } from '../../../src/delivery/health'
import type { Plan, ResolveAction } from '../../../src/state/reconcile'

function action(key: string): ResolveAction {
  return { kind: 'resolve', key, label: key, dedupKey: key, hash: 'h' }
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return { sendable: [], heldByMaintenance: [], rejected: [], ...overrides }
}

describe('DeliveryHealth', () => {
  it('opens once a sendable gap has lasted two minutes', () => {
    const health = new DeliveryHealth()
    const gap = plan({ sendable: [action('a')] })
    health.observe(gap, 0)

    expect(health.isFault({ plan: gap, now: 119_999, storeUnreadableSince: null })).toBe(false)
    expect(health.isFault({ plan: gap, now: 120_000, storeUnreadableSince: null })).toBe(true)
  })

  it('times each gap from when it first appeared, and forgets closed ones', () => {
    const health = new DeliveryHealth()
    health.observe(plan({ sendable: [action('a')] }), 0)
    health.observe(plan({ sendable: [action('a'), action('b')] }), 100_000)
    health.observe(plan({ sendable: [action('b')] }), 110_000)

    const current = plan({ sendable: [action('b')] })
    expect(health.isFault({ plan: current, now: 200_000, storeUnreadableSince: null })).toBe(false)
    expect(health.isFault({ plan: current, now: 220_000, storeUnreadableSince: null })).toBe(true)

    health.observe(plan(), 230_000)
  })

  it('never opens for a trigger held by maintenance', () => {
    const health = new DeliveryHealth()
    const held = plan({ heldByMaintenance: ['a'] })
    health.observe(held, 0)

    expect(health.isFault({ plan: held, now: 10_000_000, storeUnreadableSince: null })).toBe(false)
  })

  it('opens at once for an outstanding rejection', () => {
    const health = new DeliveryHealth()
    const rejected = plan({ rejected: ['a'] })

    expect(health.isFault({ plan: rejected, now: 0, storeUnreadableSince: null })).toBe(true)
    expect(health.causes({ plan: rejected, now: 0, storeUnreadableSince: null })).toEqual(['rejected'])
  })

  it('names a stall as well when a rejection and a stuck send overlap', () => {
    const health = new DeliveryHealth()
    const both = plan({ rejected: ['a'], sendable: [action('b')] })
    health.observe(both, 0)

    expect(health.causes({ plan: both, now: 120_000, storeUnreadableSince: null })).toEqual(['rejected', 'stalled'])
  })

  it('opens once the signal store has been unreadable for five minutes', () => {
    const health = new DeliveryHealth()

    expect(health.isFault({ plan: plan(), now: 299_999, storeUnreadableSince: 0 })).toBe(false)
    expect(health.isFault({ plan: plan(), now: 300_000, storeUnreadableSince: 0 })).toBe(true)
  })
})
