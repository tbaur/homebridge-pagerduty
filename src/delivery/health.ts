/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview When the delivery sensor opens.
 *
 * The sensor answers one question: is a page failing to go out? It opens when
 * any of these is true and closes when none is. A rejection on its own is
 * logged separately from a stall or an unreadable store, because other alerts
 * still send:
 *
 * - A *sendable* gap has lasted {@link DELIVERY_FAULT_AFTER_MS}. Held by
 *   maintenance or rejected does not count as sendable, so maintenance never
 *   opens the sensor on its own.
 * - A rejection is outstanding.
 * - The signal store has been unreadable for {@link SIGNAL_STORE_FAULT_AFTER_MS}.
 *
 * What it cannot see: a revoked or deleted integration key still gets a `2xx`
 * from PagerDuty, so it looks like successful delivery.
 */

import { DELIVERY_FAULT_AFTER_MS, SIGNAL_STORE_FAULT_AFTER_MS } from '../settings'
import type { Plan } from '../state/reconcile'

/** Why the delivery sensor is open. `rejected` alone means other alerts still send. */
export type DeliveryFaultCause = 'rejected' | 'stalled' | 'store'

/** Tracks how long each sendable gap has existed. */
export class DeliveryHealth {
  private readonly gapSince = new Map<string, number>()

  /** Fold in the latest plan. Call after every reconcile. */
  observe(plan: Plan, now: number): void {
    const sendable = new Set(plan.sendable.map((action) => action.key))
    for (const key of this.gapSince.keys()) {
      if (!sendable.has(key)) {
        this.gapSince.delete(key)
      }
    }
    for (const key of sendable) {
      if (!this.gapSince.has(key)) {
        this.gapSince.set(key, now)
      }
    }
  }

  /** Why the sensor is open. Empty when it should be closed. */
  causes(input: { plan: Plan; now: number; storeUnreadableSince: number | null }): DeliveryFaultCause[] {
    const causes: DeliveryFaultCause[] = []
    if (input.plan.rejected.length > 0) {
      causes.push('rejected')
    }
    if (input.storeUnreadableSince !== null && input.now - input.storeUnreadableSince >= SIGNAL_STORE_FAULT_AFTER_MS) {
      causes.push('store')
    }
    for (const since of this.gapSince.values()) {
      if (input.now - since >= DELIVERY_FAULT_AFTER_MS) {
        causes.push('stalled')
        break
      }
    }
    return causes
  }

  /** True when {@link causes} is not empty. */
  isFault(input: { plan: Plan; now: number; storeUnreadableSince: number | null }): boolean {
    return this.causes(input).length > 0
  }
}
