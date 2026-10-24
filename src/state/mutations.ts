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

import { signalRefKey } from '../signals/schema'
import type { ResolvedAlert, Severity, SignalRow } from '../types'
import type { PersistedState } from './model'
import { levelKey } from './model'

const MINUTE_MS = 60_000

/**
 * Apply a level switch write.
 *
 * `On` while already on changes nothing that is sent, but restarts the alert's
 * resolve timer. Turning the last level off cancels the timer. Returns true
 * when anything changed and the state should be persisted.
 */
export function applyLevelWrite(
  state: PersistedState,
  alert: ResolvedAlert,
  write: { severity: Severity; on: boolean; at: number },
): boolean {
  const key = levelKey(alert.id, write.severity)
  const wasOn = state.levels[key]?.on === true
  let changed = false
  if (write.on !== wasOn) {
    state.levels[key] = { on: write.on, changedAt: write.at }
    changed = true
  }
  if (write.on && alert.resolveAfterMinutes > 0) {
    state.alerts[alert.id] = { resolveAt: write.at + alert.resolveAfterMinutes * MINUTE_MS }
    changed = true
  } else if (!write.on && !isAnyLevelOn(state, alert) && (state.alerts[alert.id]?.resolveAt ?? null) !== null) {
    state.alerts[alert.id] = { resolveAt: null }
    changed = true
  }
  return changed
}

/** True while any level of the alert is on. */
export function isAnyLevelOn(state: PersistedState, alert: ResolvedAlert): boolean {
  return alert.levels.some((level) => state.levels[levelKey(alert.id, level.severity)]?.on === true)
}

/**
 * Turn off every level of every alert whose resolve timer has passed.
 *
 * A deadline that passed while Homebridge was down fires on the first call.
 * Returns the alerts that expired, for logging.
 */
export function expireResolveTimers(
  state: PersistedState,
  alerts: readonly ResolvedAlert[],
  now: number,
): ResolvedAlert[] {
  const expired: ResolvedAlert[] = []
  for (const alert of alerts) {
    const resolveAt = state.alerts[alert.id]?.resolveAt ?? null
    if (resolveAt === null || resolveAt > now) {
      continue
    }
    for (const level of alert.levels) {
      applyLevelWrite(state, alert, { severity: level.severity, on: false, at: now })
    }
    state.alerts[alert.id] = { resolveAt: null }
    expired.push(alert)
  }
  return expired
}

/**
 * Turn maintenance on or off. Returns true when it changed.
 *
 * Repeating `On` does not extend the window: an automation that fires every
 * hour must not be able to keep paging switched off forever.
 */
export function applyMaintenance(
  state: PersistedState,
  write: { on: boolean; at: number; maxMinutes: number },
): boolean {
  if (write.on === state.maintenance.on) {
    return false
  }
  state.maintenance = write.on
    ? { on: true, since: write.at, until: write.at + write.maxMinutes * MINUTE_MS }
    : { on: false, since: null, until: null }
  return true
}

/** The soonest resolve or maintenance deadline, or undefined when none is set. */
export function nextDeadline(state: PersistedState, alerts: readonly ResolvedAlert[]): number | undefined {
  const deadlines: number[] = []
  for (const alert of alerts) {
    const resolveAt = state.alerts[alert.id]?.resolveAt ?? null
    if (resolveAt !== null) {
      deadlines.push(resolveAt)
    }
  }
  if (state.maintenance.on && state.maintenance.until !== null) {
    deadlines.push(state.maintenance.until)
  }
  return deadlines.length > 0 ? Math.min(...deadlines) : undefined
}

/** Inputs to {@link applyRows}. */
export interface RowsUpdate {
  rows: readonly SignalRow[]
  /** False when the read hit its cap, so an absent row may simply be unread. */
  complete: boolean
  sources: readonly string[]
  /** Configured alerts bound to a row, by `<plugin>/<signal>`. */
  boundAlerts: ReadonlyMap<string, ResolvedAlert>
  now: number
}

/** Result of {@link applyRows}. */
export interface RowsResult {
  /** Rows whose `active` or `severity` changed, by `<plugin>/<signal>`. */
  changed: string[]
  /** True when anything at all was written, including a summary. */
  dirty: boolean
}

/**
 * Fold a successful read of the signal store into state.
 *
 * A row changes only when `active` or `severity` changes; an `updated_at`
 * change alone is not a change. A changed bound row drives its alert's switch,
 * and the last change wins. A row that has gone counts as cleared, but only
 * after a read that is known to be complete.
 */
export function applyRows(state: PersistedState, update: RowsUpdate): RowsResult {
  const result: RowsResult = { changed: [], dirty: false }
  const present = new Set<string>()
  for (const row of update.rows) {
    const key = signalRefKey(row)
    present.add(key)
    const previous = state.rowsSeen[key]
    if (previous !== undefined && previous.active === row.active && previous.severity === row.severity) {
      if (previous.summary !== row.summary) {
        previous.summary = row.summary
        result.dirty = true
      }
      continue
    }
    const changedAt = row.updatedAt > 0 && row.updatedAt <= update.now ? row.updatedAt : update.now
    state.rowsSeen[key] = { active: row.active, severity: row.severity, summary: row.summary, changedAt }
    driveBoundAlert({ state, alert: update.boundAlerts.get(key), on: row.active, at: changedAt })
    result.changed.push(key)
    result.dirty = true
  }
  if (update.complete) {
    clearMissingRows(state, update, present, result)
  }
  return result
}

function clearMissingRows(
  state: PersistedState,
  update: RowsUpdate,
  present: ReadonlySet<string>,
  result: RowsResult,
): void {
  for (const [key, seen] of Object.entries(state.rowsSeen)) {
    const plugin = key.slice(0, key.lastIndexOf('/'))
    if (present.has(key) || !seen.active || !update.sources.includes(plugin)) {
      continue
    }
    state.rowsSeen[key] = { ...seen, active: false, changedAt: update.now }
    driveBoundAlert({ state, alert: update.boundAlerts.get(key), on: false, at: update.now })
    result.changed.push(key)
    result.dirty = true
  }
}

function driveBoundAlert(input: {
  state: PersistedState
  alert: ResolvedAlert | undefined
  on: boolean
  at: number
}): void {
  const level = input.alert?.levels[0]
  if (input.alert === undefined || level === undefined) {
    return
  }
  applyLevelWrite(input.state, input.alert, { severity: level.severity, on: input.on, at: input.at })
}

/**
 * Drop remembered rows from packages that are no longer allowed.
 *
 * Their delivered records stay, so the reconciler still resolves anything
 * they had open. Only the memory of the row goes.
 */
export function pruneRows(state: PersistedState, sources: readonly string[]): boolean {
  let changed = false
  for (const key of Object.keys(state.rowsSeen)) {
    const plugin = key.slice(0, key.lastIndexOf('/'))
    if (!sources.includes(plugin)) {
      delete state.rowsSeen[key]
      changed = true
    }
  }
  return changed
}

/**
 * Handle a changed routing key.
 *
 * PagerDuty drops a resolve sent on a different key, so alerts opened on the
 * old key cannot be closed from here. Their records are cleared, and the
 * reconciler triggers whatever is still active on the new key. Returns the
 * delivered keys that were orphaned, for the warning.
 */
export function applyKeyChange(state: PersistedState, fingerprint: string): string[] {
  if (state.routingKeyFingerprint === fingerprint) {
    return []
  }
  const orphaned = state.routingKeyFingerprint === null ? [] : Object.keys(state.delivered)
  if (state.routingKeyFingerprint !== null) {
    state.delivered = {}
  }
  state.rejected = {}
  state.routingKeyFingerprint = fingerprint
  return orphaned
}
