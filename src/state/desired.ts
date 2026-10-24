/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Desired state, derived from configuration and persisted state.
 *
 * Pure. Every rule about alerts and levels lives here: an alert is open
 * while any level is on, its severity is the highest level
 * that is on, and a bound alert takes its severity from the last row seen.
 */

import { signalRefKey } from '../signals/schema'
import { EVENT_GROUP } from '../settings'
import type { ResolvedAlert, ResolvedConfig, SignalRef } from '../types'
import type { DesiredTarget, PersistedState } from './model'
import {
  alertDedupKey,
  alertTargetKey,
  heldTarget,
  levelKey,
  maxSeverity,
  signalDedupKey,
  signalTargetKey,
} from './model'

/** Every target that should exist, by target key. Absent means "should be closed". */
export function computeDesired(
  config: ResolvedConfig,
  state: PersistedState,
): Map<string, DesiredTarget> {
  const desired = new Map<string, DesiredTarget>()
  const bound = new Set<string>()
  for (const alert of config.alerts) {
    desired.set(alertTargetKey(alert.id), alertTarget(alert, config.source, state))
    if (alert.signal !== undefined) {
      bound.add(signalRefKey(alert.signal))
    }
  }
  for (const id of config.heldAlertIds) {
    desired.set(alertTargetKey(id), heldTarget(alertTargetKey(id), id))
  }
  for (const [refKey, row] of Object.entries(state.rowsSeen)) {
    const ref = parseRefKey(refKey)
    if (ref === undefined || bound.has(refKey) || !config.signalSources.includes(ref.plugin)) {
      continue
    }
    const key = signalTargetKey(ref)
    desired.set(key, {
      key,
      label: refKey,
      open: row.active,
      severity: row.severity,
      dedupKey: signalDedupKey(config.source, ref),
      summary: row.summary,
      changedAt: row.changedAt,
      // Rows carry no bypass. A writer that must page during maintenance is
      // bound to a configured alert with `bypassMaintenance: true`.
      bypassMaintenance: false,
      held: false,
      details: { component: ref.signal, group: ref.plugin, custom: { origin: 'signal' } },
    })
  }
  return desired
}

function alertTarget(alert: ResolvedAlert, source: string, state: PersistedState): DesiredTarget {
  const levelsOn = alert.levels.filter((level) => state.levels[levelKey(alert.id, level.severity)]?.on === true)
  const row = alert.signal === undefined ? undefined : state.rowsSeen[signalRefKey(alert.signal)]
  const highestOn = maxSeverity(levelsOn.map((level) => level.severity))
  // A bound alert follows the last row seen, including when a person turns
  // its switch on by hand. The configured severity applies until a row exists.
  const severity = row?.severity ?? highestOn ?? alert.levels[0]?.severity ?? 'critical'
  const topLevel = levelsOn.find((level) => level.severity === highestOn)
  const changedAt = Math.max(0, ...levelsOn.map((level) => state.levels[levelKey(alert.id, level.severity)]?.changedAt ?? 0))
  const custom: Record<string, string> = { origin: alert.signal === undefined ? 'switch' : 'signal' }
  if (topLevel !== undefined) {
    custom.level = topLevel.name
  }
  if (row !== undefined) {
    custom.detail = row.summary
  }
  return {
    key: alertTargetKey(alert.id),
    label: alert.name,
    open: levelsOn.length > 0,
    severity,
    dedupKey: alertDedupKey(source, alert.id),
    summary: alert.summary,
    changedAt,
    bypassMaintenance: alert.bypassMaintenance,
    held: false,
    details: { component: alert.id, group: EVENT_GROUP, custom },
  }
}

function parseRefKey(refKey: string): SignalRef | undefined {
  const slash = refKey.lastIndexOf('/')
  if (slash <= 0) {
    return undefined
  }
  return { plugin: refKey.slice(0, slash), signal: refKey.slice(slash + 1) }
}
