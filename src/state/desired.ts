/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Desired state, derived from configuration and persisted state.
 *
 * Pure. Every rule about alerts, levels and signals lives here: an alert is
 * open while any level is on, its severity is the highest level that is on,
 * and a signal follows its switch when it has one and its row when it does not.
 */

import { allowedPlugins, signalSettings, signalSwitches } from '../signals/config'
import { parseSignalRef, signalRefKey } from '../signals/schema'
import { EVENT_GROUP } from '../settings'
import type { ResolvedAlert, ResolvedConfig, ResolvedSignal } from '../types'
import type { DesiredTarget, PersistedState } from './model'
import {
  alertDedupKey,
  alertTargetKey,
  heldTarget,
  isSignalSwitchOn,
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
  for (const alert of config.alerts) {
    desired.set(alertTargetKey(alert.id), alertTarget(alert, config.source, state))
  }
  for (const id of config.heldAlertIds) {
    desired.set(alertTargetKey(id), heldTarget(alertTargetKey(id), id))
  }
  for (const refKey of signalRefKeys(config, state)) {
    const ref = parseSignalRef(refKey)
    const settings = ref === undefined ? undefined : signalSettings(config, ref)
    if (settings?.enabled === true) {
      const target = signalTarget(settings, config.source, state)
      desired.set(target.key, target)
    }
  }
  return desired
}

/** Signals with a row from an allowed plugin, plus signals with a switch but no row yet. */
function signalRefKeys(config: ResolvedConfig, state: PersistedState): Set<string> {
  const allowed = allowedPlugins(config)
  const keys = new Set(Object.keys(state.rowsSeen).filter((key) => allowed.includes(key.slice(0, key.lastIndexOf('/')))))
  for (const signal of signalSwitches(config)) {
    keys.add(signalRefKey(signal))
  }
  return keys
}

function signalTarget(settings: ResolvedSignal, source: string, state: PersistedState): DesiredTarget {
  const refKey = signalRefKey(settings)
  const row = state.rowsSeen[refKey]
  const open = settings.switch ? isSignalSwitchOn(state, refKey) : row?.active ?? false
  const custom: Record<string, string> = { origin: open && row?.active !== true ? 'switch' : 'signal' }
  if (settings.summary !== undefined && row !== undefined && row.summary !== settings.summary) {
    custom.detail = row.summary
  }
  return {
    key: signalTargetKey(settings),
    label: refKey,
    open,
    severity: settings.severity ?? row?.severity ?? 'critical',
    dedupKey: signalDedupKey(source, settings),
    summary: settings.summary ?? row?.summary ?? settings.switchName,
    changedAt: (settings.switch ? state.switches[refKey]?.changedAt : undefined) ?? row?.changedAt ?? 0,
    bypassMaintenance: settings.bypassMaintenance,
    held: false,
    details: { component: settings.signal, group: settings.plugin, custom },
  }
}

function alertTarget(alert: ResolvedAlert, source: string, state: PersistedState): DesiredTarget {
  const levelsOn = alert.levels.filter((level) => state.levels[levelKey(alert.id, level.severity)]?.on === true)
  const highestOn = maxSeverity(levelsOn.map((level) => level.severity))
  const severity = highestOn ?? alert.levels[0]?.severity ?? 'critical'
  const topLevel = levelsOn.find((level) => level.severity === highestOn)
  const changedAt = Math.max(0, ...levelsOn.map((level) => state.levels[levelKey(alert.id, level.severity)]?.changedAt ?? 0))
  const custom: Record<string, string> = { origin: 'switch' }
  if (topLevel !== undefined) {
    custom.level = topLevel.name
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
