/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The reconciler: desired against delivered, as a pure function.
 *
 * No timers, no I/O and no clock. Given the same inputs it returns the same
 * plan, which is why most of the test suite drives this directly and why a
 * restart resumes exactly where it stopped.
 *
 * Rules, per target:
 * - Delivered but no longer desired open, or delivered under a different
 *   `dedup_key`: **resolve** on the recorded key. Never held.
 * - Desired open and either not delivered, or desired severity higher than
 *   delivered: **trigger**. Held by maintenance unless the alert bypasses it.
 * - Desired severity lower than delivered: nothing. PagerDuty never lowers an
 *   alert, and the plugin does not pretend it can.
 * - A held (invalid) config entry: nothing, in either direction.
 * - An action whose hash matches an outstanding rejection: not resent.
 */
import type { Region, Severity } from '../types';
import type { DeliveredRecord, DesiredTarget, EventDetails, RejectedRecord } from './model';
/** Everything a rejection hash depends on besides the action itself. */
export interface HashContext {
    routingKeyFingerprint: string;
    region: Region;
    pluginVersion: string;
}
/** A trigger the sender may send. */
export interface TriggerAction {
    kind: 'trigger';
    key: string;
    label: string;
    dedupKey: string;
    severity: Severity;
    summary: string;
    timestamp: number;
    details: EventDetails;
    hash: string;
}
/** A resolve the sender may send. */
export interface ResolveAction {
    kind: 'resolve';
    key: string;
    label: string;
    dedupKey: string;
    hash: string;
}
export type Action = TriggerAction | ResolveAction;
/** Every gap, sorted by what may happen to it. */
export interface Plan {
    /** In send order: resolves first, then triggers, each by key. */
    sendable: Action[];
    /** Target keys with a trigger held by maintenance. */
    heldByMaintenance: string[];
    /** Target keys whose gap matches an outstanding rejection. */
    rejected: string[];
}
/** Inputs to {@link reconcile}. */
export interface ReconcileInput {
    desired: ReadonlyMap<string, DesiredTarget>;
    delivered: Readonly<Record<string, DeliveredRecord>>;
    rejected: Readonly<Record<string, RejectedRecord>>;
    maintenanceOn: boolean;
    hashContext: HashContext;
}
/**
 * The hash a rejection is recorded under.
 *
 * Covers what was (or would be) sent plus the key fingerprint, the region and
 * the plugin version. A new key, a new region or an upgrade therefore retries
 * an event PagerDuty refused, and nothing else does.
 */
export declare function actionHash(action: {
    open: boolean;
    severity: Severity | null;
    dedupKey: string;
    summary: string | null;
}, context: HashContext): string;
/** Compare desired against delivered and say what may be sent next. */
export declare function reconcile(input: ReconcileInput): Plan;
