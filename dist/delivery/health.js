"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeliveryHealth = void 0;
const settings_1 = require("../settings");
/** Tracks how long each sendable gap has existed. */
class DeliveryHealth {
    gapSince = new Map();
    /** Fold in the latest plan. Call after every reconcile. */
    observe(plan, now) {
        const sendable = new Set(plan.sendable.map((action) => action.key));
        for (const key of this.gapSince.keys()) {
            if (!sendable.has(key)) {
                this.gapSince.delete(key);
            }
        }
        for (const key of sendable) {
            if (!this.gapSince.has(key)) {
                this.gapSince.set(key, now);
            }
        }
    }
    /** True when pages are not going out. */
    isFault(input) {
        if (input.plan.rejected.length > 0) {
            return true;
        }
        if (input.storeUnreadableSince !== null && input.now - input.storeUnreadableSince >= settings_1.SIGNAL_STORE_FAULT_AFTER_MS) {
            return true;
        }
        for (const since of this.gapSince.values()) {
            if (input.now - since >= settings_1.DELIVERY_FAULT_AFTER_MS) {
                return true;
            }
        }
        return false;
    }
}
exports.DeliveryHealth = DeliveryHealth;
