/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation.
 *
 * Three outcomes, each chosen for what it costs the user when they are wrong.
 *
 * - **Not configured.** No routing key. One log line, nothing started, cached
 *   accessories kept, as verified review requires.
 * - **Invalid.** The file does not describe anything usable. The platform
 *   disables itself and keeps cached accessories, so a typo does not cost
 *   anyone their automations.
 * - **One bad alert.** An entry with a readable `id` but a bad field is
 *   *held*: its state and accessories stay exactly as they were and nothing is
 *   sent for it. Treating it as removed would resolve a live incident.
 *
 * Nothing here ever puts the routing key into a message: not its length, not
 * a prefix, not "you typed ... ". Validation says whether it is usable.
 */

import { isAllowableSource, parseSignalRef } from '../signals/schema'
import {
  DEFAULT_MAINTENANCE_MAX_MINUTES,
  DEFAULT_SOURCE,
  MAX_ALERTS,
  MAX_DIAGNOSTICS_INTERVAL_SEC,
  MAX_LEVELS,
  MAX_MAINTENANCE_MAX_MINUTES,
  MAX_NAME_LENGTH,
  MAX_RESOLVE_AFTER_MINUTES,
  MAX_SUMMARY_LENGTH,
  MIN_DIAGNOSTICS_INTERVAL_SEC,
  MIN_MAINTENANCE_MAX_MINUTES,
} from '../settings'
import type {
  AlertConfig,
  LevelConfig,
  PagerDutyPlatformConfig,
  Region,
  ResolvedAccessory,
  ResolvedAlert,
  ResolvedConfig,
  ResolvedLevel,
  ResolvedOptions,
  Severity,
} from '../types'
import { isSeverity } from '../types'
import { forLog } from './redact'

/** Outcome of validating a platform configuration block. */
export interface ConfigValidationResult {
  status: 'ok' | 'notConfigured' | 'invalid'
  /** Fatal problems. Non-empty exactly when `status` is `invalid`. */
  errors: string[]
  /** Problems worth reporting that do not prevent operation. */
  warnings: string[]
  /** Present exactly when `status` is `ok`. */
  config?: ResolvedConfig
}

/** Pattern for the integration key. Ruleset keys start with `R`; same shape. */
export const ROUTING_KEY_PATTERN = /^[A-Za-z0-9]{32}$/
export const SOURCE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/
export const ALERT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

type AlertOutcome =
  | { kind: 'ok'; alert: ResolvedAlert }
  | { kind: 'held'; id: string }
  | { kind: 'skip' }

/**
 * Validate a platform configuration block.
 *
 * Never throws: the platform needs the errors and warnings in order to report
 * them, and a configuration problem should produce a diagnosable log rather
 * than an exception during Homebridge startup.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    return { status: 'invalid', errors: ['platform configuration is missing'], warnings }
  }
  const config = raw as PagerDutyPlatformConfig
  const key = validateRoutingKey(config.routingKey, errors, warnings)
  if (key === 'absent') {
    return { status: 'notConfigured', errors, warnings }
  }
  const region = validateRegion(config.region, warnings)
  const source = validateSource(config.source, errors)
  const signalSources = validateSources(config.signals?.sources, warnings)
  const { alerts, heldAlertIds } = validateAlerts(config.alerts, errors, warnings)
  warnAboutUnreadSignals(alerts, signalSources, warnings)
  const maintenance = {
    switch: config.maintenance?.switch === true,
    maxMinutes: clampInteger({
      value: config.maintenance?.maxMinutes,
      label: 'maintenance.maxMinutes',
      range: [MIN_MAINTENANCE_MAX_MINUTES, MAX_MAINTENANCE_MAX_MINUTES],
      fallback: DEFAULT_MAINTENANCE_MAX_MINUTES,
      warnings,
    }),
  }
  const options = validateOptions(config.options, warnings)
  if (errors.length > 0 || key === undefined || source === undefined) {
    return { status: 'invalid', errors, warnings }
  }
  return {
    status: 'ok',
    errors,
    warnings,
    config: { routingKey: key, region, source, alerts, heldAlertIds, maintenance, signalSources, options },
  }
}

function validateRoutingKey(
  value: unknown,
  errors: string[],
  warnings: string[],
): string | 'absent' | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return 'absent'
  }
  if (typeof value !== 'string') {
    errors.push('routingKey must be a string')
    return undefined
  }
  const trimmed = value.trim()
  if (!ROUTING_KEY_PATTERN.test(trimmed)) {
    errors.push('routingKey is not a 32-character PagerDuty integration key')
    return undefined
  }
  if (trimmed !== value) {
    // Said without quoting anything. A pasted key often carries a newline.
    warnings.push('routingKey had surrounding whitespace; trimmed')
  }
  return trimmed
}

function validateRegion(value: unknown, warnings: string[]): Region {
  if (value === undefined || value === 'us' || value === 'eu') {
    return value ?? 'us'
  }
  warnings.push(`region ${forLog(value)} is not us or eu; using us`)
  return 'us'
}

/**
 * `source` is fatal when wrong rather than defaulted: it is part of every
 * `dedup_key`, and a silent fallback would orphan every open alert.
 */
function validateSource(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return DEFAULT_SOURCE
  }
  if (typeof value !== 'string' || !SOURCE_PATTERN.test(value)) {
    errors.push('source must be 1-32 letters, digits, dot, underscore or hyphen')
    return undefined
  }
  return value
}

function validateSources(value: unknown, warnings: string[]): string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    warnings.push('signals.sources is not a list; the signal store stays closed')
    return []
  }
  const sources: string[] = []
  for (const entry of value) {
    if (!isAllowableSource(entry)) {
      warnings.push(`signals.sources entry ${forLog(entry)} is not a usable package name; skipped`)
    } else if (!sources.includes(entry)) {
      sources.push(entry)
    }
  }
  return sources
}

function validateAlerts(
  value: unknown,
  errors: string[],
  warnings: string[],
): { alerts: ResolvedAlert[]; heldAlertIds: string[] } {
  const alerts: ResolvedAlert[] = []
  const heldAlertIds: string[] = []
  if (value === undefined) {
    return { alerts, heldAlertIds }
  }
  if (!Array.isArray(value)) {
    errors.push('alerts must be a list')
    return { alerts, heldAlertIds }
  }
  if (value.length > MAX_ALERTS) {
    errors.push(`at most ${MAX_ALERTS} alerts are supported; found ${value.length}`)
    return { alerts, heldAlertIds }
  }
  const seen = new Set<string>()
  value.forEach((entry: unknown, index) => {
    const outcome = validateAlert(entry, index, warnings)
    if (outcome.kind === 'skip') {
      return
    }
    const id = outcome.kind === 'ok' ? outcome.alert.id : outcome.id
    if (seen.has(id)) {
      warnings.push(`alerts[${index}] repeats id ${id}; skipping the duplicate`)
      return
    }
    seen.add(id)
    if (outcome.kind === 'ok') {
      alerts.push(outcome.alert)
    } else {
      heldAlertIds.push(id)
    }
  })
  return { alerts, heldAlertIds }
}

function validateAlert(entry: unknown, index: number, warnings: string[]): AlertOutcome {
  const label = `alerts[${index}]`
  if (typeof entry !== 'object' || entry === null) {
    warnings.push(`${label} is not an object; skipped`)
    return { kind: 'skip' }
  }
  const alert = entry as AlertConfig
  if (typeof alert.id !== 'string' || !ALERT_ID_PATTERN.test(alert.id)) {
    warnings.push(`${label} has no usable id (lowercase letters, digits and hyphens, starting with a letter); skipped`)
    return { kind: 'skip' }
  }
  const id = alert.id
  const problems: string[] = []
  const name = validateText({ value: alert.name, field: 'name', max: MAX_NAME_LENGTH, problems })
  const summary = validateText({ value: alert.summary, field: 'summary', max: MAX_SUMMARY_LENGTH, problems })
  const levels = validateLevels(alert.levels, name ?? id, problems)
  const resolveAfterMinutes = validateMinutes(alert.resolveAfterMinutes, problems)
  const signal = validateBinding(alert.signal, levels, problems)
  if (name === undefined || summary === undefined || levels === undefined || problems.length > 0) {
    warnings.push(`alert ${id} is held until fixed (nothing is sent or removed): ${problems.join('; ')}`)
    return { kind: 'held', id }
  }
  return {
    kind: 'ok',
    alert: {
      id,
      name,
      summary,
      levels,
      resolveAfterMinutes,
      bypassMaintenance: alert.bypassMaintenance === true,
      ...(signal === undefined ? {} : { signal }),
    },
  }
}

function validateText(input: {
  value: unknown
  field: string
  max: number
  problems: string[]
}): string | undefined {
  const { value, field, max, problems } = input
  if (typeof value !== 'string' || value.trim().length === 0) {
    problems.push(`${field} is missing`)
    return undefined
  }
  const text = value.trim()
  if (CONTROL_CHARACTERS.test(text)) {
    problems.push(`${field} contains control characters`)
    return undefined
  }
  if (text.length > max) {
    problems.push(`${field} is longer than ${max} characters`)
    return undefined
  }
  return text
}

function validateLevels(value: unknown, alertName: string, problems: string[]): ResolvedLevel[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LEVELS) {
    problems.push(`levels must list 1 to ${MAX_LEVELS} entries`)
    return undefined
  }
  const severities: Severity[] = []
  const names: (string | undefined)[] = []
  for (const entry of value as unknown[]) {
    const level = (typeof entry === 'object' && entry !== null ? entry : {}) as LevelConfig
    if (!isSeverity(level.severity) || severities.includes(level.severity)) {
      problems.push('each level needs a distinct severity: info, warning, error or critical')
      return undefined
    }
    severities.push(level.severity)
    names.push(level.name === undefined
      ? undefined
      : validateText({ value: level.name, field: 'level name', max: MAX_NAME_LENGTH, problems }))
  }
  if (problems.length > 0) {
    return undefined
  }
  return severities.map((severity, index) => ({
    severity,
    name: names[index] ?? defaultLevelName(alertName, severity, severities.length),
  }))
}

/** `Leak` for a single level, `Freezer Critical` otherwise, within HomeKit's budget. */
export function defaultLevelName(alertName: string, severity: Severity, levelCount: number): string {
  if (levelCount === 1) {
    return alertName
  }
  const suffix = `${severity[0]?.toUpperCase() ?? ''}${severity.slice(1)}`
  const combined = `${alertName} ${suffix}`
  if (combined.length <= MAX_NAME_LENGTH) {
    return combined
  }
  return `${alertName.slice(0, MAX_NAME_LENGTH - suffix.length - 2)}\u2026 ${suffix}`
}

function validateMinutes(value: unknown, problems: string[]): number {
  if (value === undefined) {
    return 0
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_RESOLVE_AFTER_MINUTES) {
    problems.push(`resolveAfterMinutes must be a whole number from 0 to ${MAX_RESOLVE_AFTER_MINUTES}`)
    return 0
  }
  return value
}

function validateBinding(
  value: unknown,
  levels: ResolvedLevel[] | undefined,
  problems: string[],
): ResolvedAlert['signal'] {
  if (value === undefined || value === '') {
    return undefined
  }
  const ref = parseSignalRef(value)
  if (ref === undefined) {
    problems.push('signal must be <package>/<signal>')
    return undefined
  }
  if (levels !== undefined && levels.length !== 1) {
    problems.push('an alert bound to a signal must have exactly one level')
  }
  return ref
}

function warnAboutUnreadSignals(alerts: ResolvedAlert[], sources: string[], warnings: string[]): void {
  for (const alert of alerts) {
    if (alert.signal !== undefined && !sources.includes(alert.signal.plugin)) {
      warnings.push(
        `alert ${alert.id} is bound to ${alert.signal.plugin}, which is not in signals.sources; `
        + 'its row is never read',
      )
    }
  }
}

function validateOptions(value: PagerDutyPlatformConfig['options'], warnings: string[]): ResolvedOptions {
  return {
    deliveryFaultSensor: value?.deliveryFaultSensor !== false,
    dryRun: value?.dryRun === true,
    diagnosticsInterval: resolveDiagnosticsIntervalSec(value?.diagnosticsInterval, warnings),
    structuredLogs: value?.structuredLogs === true,
  }
}

function clampInteger(input: {
  value: unknown
  label: string
  range: [number, number]
  fallback: number
  warnings: string[]
}): number {
  const { value, label, range, fallback, warnings } = input
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`${label} is not a number; using ${fallback}`)
    return fallback
  }
  const clamped = Math.min(range[1], Math.max(range[0], Math.round(value)))
  if (clamped !== value) {
    warnings.push(`${label} clamped to ${clamped}`)
  }
  return clamped
}

/**
 * Resolve the diagnostics heartbeat interval.
 *
 * `0` and anything not a number is off. Values between 1 and 29 clamp up to
 * 30 so a typo does not silently disable the heartbeat.
 */
export function resolveDiagnosticsIntervalSec(value: unknown, warnings?: string[]): number {
  if (value === undefined || value === 0) {
    return 0
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    warnings?.push('options.diagnosticsInterval is not a usable number; diagnostics stay off')
    return 0
  }
  const rounded = Math.round(numeric)
  if (rounded === 0) {
    return 0
  }
  const clamped = Math.min(MAX_DIAGNOSTICS_INTERVAL_SEC, Math.max(MIN_DIAGNOSTICS_INTERVAL_SEC, rounded))
  if (clamped !== numeric) {
    warnings?.push(`options.diagnosticsInterval clamped to ${clamped}s`)
  }
  return clamped
}

/**
 * Expand a configuration into the accessories to expose.
 *
 * Two tiles sharing a name still work but make Siri ambiguous, so duplicates
 * are warned about once here.
 */
export function resolveAccessories(config: ResolvedConfig, warnings?: string[]): ResolvedAccessory[] {
  const accessories: ResolvedAccessory[] = []
  for (const alert of config.alerts) {
    for (const level of alert.levels) {
      accessories.push({ kind: 'alert', name: level.name, alertId: alert.id, severity: level.severity })
    }
  }
  if (config.maintenance.switch) {
    accessories.push({ kind: 'maintenance', name: 'PagerDuty Maintenance' })
  }
  if (config.options.deliveryFaultSensor) {
    accessories.push({ kind: 'delivery', name: 'PagerDuty Delivery' })
  }
  const counts = new Map<string, number>()
  for (const accessory of accessories) {
    counts.set(accessory.name, (counts.get(accessory.name) ?? 0) + 1)
  }
  for (const [name, count] of counts) {
    if (count > 1) {
      warnings?.push(`duplicate name: ${forLog(name)} (${count})`)
    }
  }
  return accessories
}
