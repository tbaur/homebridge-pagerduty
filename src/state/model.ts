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

import type { Severity, SignalRef } from '../types'
import { SEVERITIES, severityRank } from '../types'

/** Bumped only for a change an older version cannot read. */
export const STATE_VERSION = 1

/** One level switch. */
export interface LevelState {
  on: boolean
  /** When it last changed. Feeds `payload.timestamp`. */
  changedAt: number
}

/** The last values seen for one signal row. Persisted so a change made while Homebridge was down is still noticed. */
export interface RowSeen {
  active: boolean
  severity: Severity
  summary: string
  changedAt: number
}

/** What PagerDuty accepted for one target. Present only while it is open there. */
export interface DeliveredRecord {
  /** The exact key used. A resolve always reuses it, so a `source` change orphans nothing. */
  dedupKey: string
  severity: Severity
  openedAt: number
  /**
   * The summary that was sent. Absent on a file written before summary updates
   * were tracked, which must not by itself cause a new trigger.
   */
  summary?: string
}

/** A state PagerDuty refused with a `4xx`. Not resent until the desired state differs. */
export interface RejectedRecord {
  desiredHash: string
  at: number
  reason: string
}

/** The whole state file. Private to this plugin and not part of any interface. */
export interface PersistedState {
  version: typeof STATE_VERSION
  /** SHA-256 of the routing key, never the key. Detects a key change. */
  routingKeyFingerprint: string | null
  /** Key: {@link levelKey}. */
  levels: Record<string, LevelState>
  /** Key: alert id. */
  alerts: Record<string, { resolveAt: number | null }>
  maintenance: { on: boolean; since: number | null; until: number | null }
  /** Key: `<plugin>/<signal>`. */
  rowsSeen: Record<string, RowSeen>
  /**
   * Signal switches, key `<plugin>/<signal>`. The row sets a switch when it
   * changes, and a person can set it by hand in between. Absent until either
   * happens, and the row decides until then.
   */
  switches: Record<string, LevelState>
  /** Key: {@link alertTargetKey} or {@link signalTargetKey}. */
  delivered: Record<string, DeliveredRecord>
  /** Same keys as `delivered`. */
  rejected: Record<string, RejectedRecord>
}

/** A state with nothing in it: first run, or after a corrupt file. */
export function emptyState(): PersistedState {
  return {
    version: STATE_VERSION,
    routingKeyFingerprint: null,
    levels: {},
    alerts: {},
    maintenance: { on: false, since: null, until: null },
    rowsSeen: {},
    switches: {},
    delivered: {},
    rejected: {},
  }
}

/** True while a signal switch is on. Keyed by `<plugin>/<signal>`. */
export function isSignalSwitchOn(state: PersistedState, refKey: string): boolean {
  return state.switches[refKey]?.on ?? state.rowsSeen[refKey]?.active ?? false
}

/** Key for one level switch. */
export function levelKey(alertId: string, severity: Severity): string {
  return `${alertId}:${severity}`
}

/** Target key for a configured alert. */
export function alertTargetKey(alertId: string): string {
  return `alert:${alertId}`
}

/** Target key for a signal, with or without a switch. */
export function signalTargetKey(ref: SignalRef): string {
  return `signal:${ref.plugin}/${ref.signal}`
}

/** `dedup_key` for an alert: `<source>/<alertId>`. */
export function alertDedupKey(source: string, alertId: string): string {
  return `${source}/${alertId}`
}

/**
 * `dedup_key` for a signal: `<source>/<plugin>/<signal>`.
 *
 * An alert id cannot contain `/`, so the two forms cannot collide. At most
 * 32 + 1 + 128 + 1 + 64 = 226 characters, under PagerDuty's 255.
 */
export function signalDedupKey(source: string, ref: SignalRef): string {
  return `${source}/${ref.plugin}/${ref.signal}`
}

/** The highest severity in a list, or undefined for an empty one. */
export function maxSeverity(severities: readonly Severity[]): Severity | undefined {
  let best: Severity | undefined
  for (const severity of severities) {
    if (best === undefined || severityRank(severity) > severityRank(best)) {
      best = severity
    }
  }
  return best
}

/** Fields that go into the event body besides summary and severity. */
export interface EventDetails {
  component: string
  group: string
  custom: Record<string, string>
}

/** What one target should look like in PagerDuty right now. */
export interface DesiredTarget {
  key: string
  /** Human name for log lines. Untrusted for signal rows; pass through `forLog`. */
  label: string
  open: boolean
  severity: Severity
  dedupKey: string
  summary: string
  /** When the condition last changed. Sent as `payload.timestamp`. */
  changedAt: number
  bypassMaintenance: boolean
  /** An invalid config entry. Nothing is sent for it, open or closed. */
  held: boolean
  details: EventDetails
}

/** A placeholder target for a held alert. Only `held` is read. */
export function heldTarget(key: string, label: string): DesiredTarget {
  return {
    key,
    label,
    open: false,
    severity: SEVERITIES[0],
    dedupKey: '',
    summary: '',
    changedAt: 0,
    bypassMaintenance: false,
    held: true,
    details: { component: '', group: '', custom: {} },
  }
}
