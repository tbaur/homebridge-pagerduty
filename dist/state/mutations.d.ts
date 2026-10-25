/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Every change to persisted state, as functions of the state and
 * the time.
 *
 * Kept free of timers and I/O so each rule is tested by calling it. The
 * controller decides when to call these and persists the result.
 */
import type { ResolvedAlert, Severity, SignalRow } from '../types';
import type { PersistedState } from './model';
/**
 * Apply a level switch write.
 *
 * `On` while already on changes nothing that is sent, but restarts the alert's
 * resolve timer. Turning the last level off cancels the timer. Returns true
 * when anything changed and the state should be persisted.
 */
export declare function applyLevelWrite(state: PersistedState, alert: ResolvedAlert, write: {
    severity: Severity;
    on: boolean;
    at: number;
}): boolean;
/** True while any level of the alert is on. */
export declare function isAnyLevelOn(state: PersistedState, alert: ResolvedAlert): boolean;
/**
 * Turn off every level of every alert whose resolve timer has passed.
 *
 * A deadline that passed while Homebridge was down fires on the first call.
 * Returns the alerts that expired, for logging.
 */
export declare function expireResolveTimers(state: PersistedState, alerts: readonly ResolvedAlert[], now: number): ResolvedAlert[];
/**
 * Turn maintenance on or off. Returns true when it changed.
 *
 * Repeating `On` does not extend the window: an automation that fires every
 * hour must not be able to keep paging switched off forever.
 */
export declare function applyMaintenance(state: PersistedState, write: {
    on: boolean;
    at: number;
    maxMinutes: number;
}): boolean;
/** The soonest resolve or maintenance deadline, or undefined when none is set. */
export declare function nextDeadline(state: PersistedState, alerts: readonly ResolvedAlert[]): number | undefined;
/** Inputs to {@link applyRows}. */
export interface RowsUpdate {
    rows: readonly SignalRow[];
    /** False when the read hit its cap, so an absent row may simply be unread. */
    complete: boolean;
    allowed: readonly string[];
    /** Signals that have a switch, by `<plugin>/<signal>`. */
    switches: ReadonlySet<string>;
    now: number;
}
/** Result of {@link applyRows}. */
export interface RowsResult {
    /** Rows whose `active` or `severity` changed, by `<plugin>/<signal>`. */
    changed: string[];
    /** True when anything at all was written, including a summary. */
    dirty: boolean;
}
/**
 * Fold a successful read of the signal store into state.
 *
 * A row changes only when `active` or `severity` changes; an `updated_at`
 * change alone is not a change. A changed row sets its signal's switch unless
 * a person set the switch after the row changed: the later change wins, by
 * when it happened, not by when it was read. A row that has gone counts as cleared,
 * but only after a read that is known to be complete.
 */
export declare function applyRows(state: PersistedState, update: RowsUpdate): RowsResult;
/** A person set a signal switch. Returns true when it changed. */
export declare function applySignalSwitchWrite(state: PersistedState, refKey: string, write: {
    on: boolean;
    at: number;
}): boolean;
/**
 * Drop remembered rows from plugins that are no longer allowed, and switch
 * state for signals that no longer have a switch.
 *
 * Delivered records stay, so the reconciler still resolves anything that was
 * open. Only the memory of the row or switch goes.
 */
export declare function pruneSignals(state: PersistedState, keep: {
    allowed: readonly string[];
    switches: ReadonlySet<string>;
}): boolean;
/**
 * Handle a changed routing key.
 *
 * PagerDuty drops a resolve sent on a different key, so alerts opened on the
 * old key cannot be closed from here. Their records are cleared, and the
 * reconciler triggers whatever is still active on the new key. Returns the
 * delivered keys that were orphaned, for the warning.
 */
export declare function applyKeyChange(state: PersistedState, fingerprint: string): string[];
