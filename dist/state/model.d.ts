/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The persisted state, its keys, and the desired-state type the
 * reconciler compares against it.
 *
 * Two states, both persisted. **Desired**: for each alert, whether it should be
 * open and at what severity, derived from the switches, the signal rows, the
 * resolve timers and the maintenance switch. **Delivered**: what PagerDuty has
 * accepted, written only after a `2xx`. One sender closes the gap between
 * them. Restart, outage and maintenance then need no rules of their own.
 */
import type { Severity, SignalRef } from '../types';
/** Bumped only for a change an older version cannot read. */
export declare const STATE_VERSION = 1;
/** One level switch. */
export interface LevelState {
    on: boolean;
    /** When it last changed. Feeds `payload.timestamp`. */
    changedAt: number;
}
/** The last values seen for one signal row. Persisted so a change made while Homebridge was down is still noticed. */
export interface RowSeen {
    active: boolean;
    severity: Severity;
    summary: string;
    changedAt: number;
}
/** What PagerDuty accepted for one target. Present only while it is open there. */
export interface DeliveredRecord {
    /** The exact key used. A resolve always reuses it, so a `source` change orphans nothing. */
    dedupKey: string;
    severity: Severity;
    openedAt: number;
}
/** A state PagerDuty refused with a `4xx`. Not resent until the desired state differs. */
export interface RejectedRecord {
    desiredHash: string;
    at: number;
    reason: string;
}
/** The whole state file. Private to this plugin and not part of any interface. */
export interface PersistedState {
    version: typeof STATE_VERSION;
    /** SHA-256 of the routing key, never the key. Detects a key change. */
    routingKeyFingerprint: string | null;
    /** Key: {@link levelKey}. */
    levels: Record<string, LevelState>;
    /** Key: alert id. */
    alerts: Record<string, {
        resolveAt: number | null;
    }>;
    maintenance: {
        on: boolean;
        since: number | null;
        until: number | null;
    };
    /** Key: `<plugin>/<signal>`. */
    rowsSeen: Record<string, RowSeen>;
    /** Key: {@link alertTargetKey} or {@link signalTargetKey}. */
    delivered: Record<string, DeliveredRecord>;
    /** Same keys as `delivered`. */
    rejected: Record<string, RejectedRecord>;
}
/** A state with nothing in it: first run, or after a corrupt file. */
export declare function emptyState(): PersistedState;
/** Key for one level switch. */
export declare function levelKey(alertId: string, severity: Severity): string;
/** Target key for a configured alert. */
export declare function alertTargetKey(alertId: string): string;
/** Target key for an unbound signal row. */
export declare function signalTargetKey(ref: SignalRef): string;
/** `dedup_key` for an alert: `<source>/<alertId>`. */
export declare function alertDedupKey(source: string, alertId: string): string;
/**
 * `dedup_key` for an unbound row: `<source>/<plugin>/<signal>`.
 *
 * An alert id cannot contain `/`, so the two forms cannot collide. At most
 * 32 + 1 + 128 + 1 + 64 = 226 characters, under PagerDuty's 255.
 */
export declare function signalDedupKey(source: string, ref: SignalRef): string;
/** The highest severity in a list, or undefined for an empty one. */
export declare function maxSeverity(severities: readonly Severity[]): Severity | undefined;
/** Fields that go into the event body besides summary and severity. */
export interface EventDetails {
    component: string;
    group: string;
    custom: Record<string, string>;
}
/** What one target should look like in PagerDuty right now. */
export interface DesiredTarget {
    key: string;
    /** Human name for log lines. Untrusted for signal rows; pass through `forLog`. */
    label: string;
    open: boolean;
    severity: Severity;
    dedupKey: string;
    summary: string;
    /** When the condition last changed. Sent as `payload.timestamp`. */
    changedAt: number;
    bypassMaintenance: boolean;
    /** An invalid config entry. Nothing is sent for it, open or closed. */
    held: boolean;
    details: EventDetails;
}
/** A placeholder target for a held alert. Only `held` is read. */
export declare function heldTarget(key: string, label: string): DesiredTarget;
