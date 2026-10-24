/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview When the delivery sensor opens.
 *
 * The sensor answers one question: are pages going out? It opens when any of
 * these is true and closes when none is:
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
import type { Plan } from '../state/reconcile';
/** Tracks how long each sendable gap has existed. */
export declare class DeliveryHealth {
    private readonly gapSince;
    /** Fold in the latest plan. Call after every reconcile. */
    observe(plan: Plan, now: number): void;
    /** True when pages are not going out. */
    isFault(input: {
        plan: Plan;
        now: number;
        storeUnreadableSince: number | null;
    }): boolean;
}
