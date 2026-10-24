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

import { requestedSignalSwitches, signalSwitches } from '../signals/config'
import { defaultSignalSwitchName, isValidSignalName, pluginConfigKey, pluginFromConfigKey } from '../signals/schema'
import {
  DEFAULT_DELIVERY_SENSOR_NAME,
  DEFAULT_MAINTENANCE_MAX_MINUTES,
  DEFAULT_MAINTENANCE_NAME,
  DEFAULT_SOURCE,
  MAX_ALERTS,
  MAX_DIAGNOSTICS_INTERVAL_SEC,
  MAX_LEVELS,
  MAX_MAINTENANCE_MAX_MINUTES,
  MAX_NAME_LENGTH,
  MAX_RESOLVE_AFTER_MINUTES,
  MAX_SIGNAL_PLUGINS,
  MAX_SIGNAL_SWITCHES,
  MAX_SIGNALS_PER_PLUGIN,
  MAX_SUMMARY_LENGTH,
  MIN_DIAGNOSTICS_INTERVAL_SEC,
  MIN_MAINTENANCE_MAX_MINUTES,
  SEVERITY_FROM_PLUGIN,
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
  ResolvedSignal,
  ResolvedSignalPlugin,
  Severity,
  SignalPluginConfig,
  SignalSettingsConfig,
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
  const signalPlugins = validateSignalPlugins(config.signals, warnings)
  const { alerts, heldAlertIds } = validateAlerts(config.alerts, errors, warnings)
  const maintenance = {
    switch: config.maintenance?.switch === true,
    name: validateAccessoryName({
      value: config.maintenance?.name,
      label: 'maintenance.name',
      fallback: DEFAULT_MAINTENANCE_NAME,
      warnings,
    }),
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
    config: { routingKey: key, region, source, alerts, heldAlertIds, maintenance, signalPlugins, options },
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `signals`: one entry per plugin, keyed by `pluginConfigKey`.
 *
 * A bad entry is skipped with a warning and never fails the config. The
 * settings screen for this section is built from other plugins' data, and
 * nothing in it may stop the user's own alerts from working.
 */
function validateSignalPlugins(value: unknown, warnings: string[]): ResolvedSignalPlugin[] {
  if (value === undefined) {
    return []
  }
  if (!isPlainObject(value)) {
    warnings.push('signals is not an object; no plugin may page')
    return []
  }
  const plugins: ResolvedSignalPlugin[] = []
  for (const [key, entry] of Object.entries(value)) {
    const plugin = pluginFromConfigKey(key)
    if (plugin === undefined || !isPlainObject(entry)) {
      warnings.push(`signals: ${forLog(key)} is not a package name with settings; skipped`)
    } else if (plugins.some((existing) => existing.plugin === plugin)) {
      warnings.push(`signals: ${plugin} appears twice; the second entry is skipped`)
    } else if (plugins.length >= MAX_SIGNAL_PLUGINS) {
      warnings.push(`signals: at most ${MAX_SIGNAL_PLUGINS} plugins are read; ${plugin} skipped`)
    } else {
      plugins.push(validateSignalPlugin(plugin, entry as SignalPluginConfig, warnings))
    }
  }
  return plugins
}

function validateSignalPlugin(plugin: string, entry: SignalPluginConfig, warnings: string[]): ResolvedSignalPlugin {
  const label = `signals.${pluginConfigKey(plugin)}`
  if (entry.signals !== undefined && !isPlainObject(entry.signals)) {
    warnings.push(`${label}.signals is not an object; its signals use the plugin's settings`)
  }
  const signals: ResolvedSignal[] = []
  for (const [name, settings] of Object.entries(isPlainObject(entry.signals) ? entry.signals : {})) {
    if (!isValidSignalName(name) || !isPlainObject(settings)) {
      warnings.push(`${label}: ${forLog(name)} is not a signal name with settings; skipped`)
    } else if (signals.length >= MAX_SIGNALS_PER_PLUGIN) {
      warnings.push(`${label}: at most ${MAX_SIGNALS_PER_PLUGIN} signals are read; ${name} skipped`)
    } else {
      signals.push(validateSignalSettings({ plugin, signal: name }, settings as SignalSettingsConfig, warnings))
    }
  }
  return { plugin, allow: entry.allow === true, signals }
}

function validateSignalSettings(
  ref: { plugin: string; signal: string },
  settings: SignalSettingsConfig,
  warnings: string[],
): ResolvedSignal {
  const label = `signals.${pluginConfigKey(ref.plugin)}.signals.${ref.signal}`
  const summary = validateSummaryOverride(settings.summary, `${label}.summary`, warnings)
  const severity = validateSeverityOverride(settings.severity, `${label}.severity`, warnings)
  return {
    ...ref,
    enabled: settings.enabled !== false,
    ...(summary === undefined ? {} : { summary }),
    ...(severity === undefined ? {} : { severity }),
    bypassMaintenance: settings.bypassMaintenance === true,
    switch: settings.switch === true,
    switchName: validateAccessoryName({
      value: settings.switchName,
      label: `${label}.switchName`,
      fallback: defaultSignalSwitchName(ref.signal),
      warnings,
    }),
  }
}

/** Blank keeps the plugin's text. A bad value does too, with a warning. */
function validateSummaryOverride(value: unknown, label: string, warnings: string[]): string | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined
  }
  if (typeof value !== 'string') {
    warnings.push(`${label} is not text; using the plugin's text`)
    return undefined
  }
  const problems: string[] = []
  const summary = validateText({ value, field: label, max: MAX_SUMMARY_LENGTH, problems })
  if (summary === undefined) {
    warnings.push(`${problems.join('; ')}; using the plugin's text`)
  }
  return summary
}

function validateSeverityOverride(value: unknown, label: string, warnings: string[]): Severity | undefined {
  if (value === undefined || value === SEVERITY_FROM_PLUGIN || value === '') {
    return undefined
  }
  if (isSeverity(value)) {
    return value
  }
  warnings.push(`${label} ${forLog(value)} is not a severity; using the plugin's`)
  return undefined
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
  if (name === undefined || summary === undefined || levels === undefined || problems.length > 0) {
    warnings.push(`alert ${id} is held until fixed (nothing is sent or removed): ${problems.join('; ')}`)
    return { kind: 'held', id }
  }
  if (hasLevelNames(alert.levels)) {
    warnings.push(`alert ${id}: level names are no longer used; each switch is named ${forLog(name)} plus its severity`)
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

/** An optional accessory name. A bad value keeps the default rather than holding the accessory. */
function validateAccessoryName(input: { value: unknown; label: string; fallback: string; warnings: string[] }): string {
  const { value, label, fallback, warnings } = input
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return fallback
  }
  if (typeof value !== 'string') {
    warnings.push(`${label} is not text; using ${forLog(fallback)}`)
    return fallback
  }
  const problems: string[] = []
  const name = validateText({ value, field: label, max: MAX_NAME_LENGTH, problems })
  if (name === undefined) {
    warnings.push(`${problems.join('; ')}; using ${forLog(fallback)}`)
    return fallback
  }
  return name
}

/** Each level is a switch named with the alert's prefix and its severity, so the name always says which switch it is. */
function validateLevels(value: unknown, prefix: string, problems: string[]): ResolvedLevel[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LEVELS) {
    problems.push(`levels must list 1 to ${MAX_LEVELS} entries`)
    return undefined
  }
  const severities: Severity[] = []
  for (const entry of value as unknown[]) {
    const level = (typeof entry === 'object' && entry !== null ? entry : {}) as LevelConfig
    if (!isSeverity(level.severity) || severities.includes(level.severity)) {
      problems.push('each level needs a distinct severity: info, warning, error or critical')
      return undefined
    }
    severities.push(level.severity)
  }
  return severities.map((severity) => ({ severity, name: levelSwitchName(prefix, severity) }))
}

function hasLevelNames(levels: unknown): boolean {
  return Array.isArray(levels) && levels.some((level) => typeof level === 'object' && level !== null && 'name' in level)
}

/** `Leak Critical`, within HomeKit's budget. */
export function levelSwitchName(prefix: string, severity: Severity): string {
  const suffix = `${severity[0]?.toUpperCase() ?? ''}${severity.slice(1)}`
  const combined = `${prefix} ${suffix}`
  if (combined.length <= MAX_NAME_LENGTH) {
    return combined
  }
  return `${prefix.slice(0, MAX_NAME_LENGTH - suffix.length - 2)}\u2026 ${suffix}`
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

function validateOptions(value: PagerDutyPlatformConfig['options'], warnings: string[]): ResolvedOptions {
  return {
    deliveryFaultSensor: value?.deliveryFaultSensor !== false,
    deliveryFaultSensorName: validateAccessoryName({
      value: value?.deliveryFaultSensorName,
      label: 'options.deliveryFaultSensorName',
      fallback: DEFAULT_DELIVERY_SENSOR_NAME,
      warnings,
    }),
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
  accessories.push(...resolveSignalSwitches(config, warnings))
  if (config.maintenance.switch) {
    accessories.push({ kind: 'maintenance', name: config.maintenance.name })
  }
  if (config.options.deliveryFaultSensor) {
    accessories.push({ kind: 'delivery', name: config.options.deliveryFaultSensorName })
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

/** A switch for each signal that asks for one, from allowed plugins only, up to the cap. */
function resolveSignalSwitches(config: ResolvedConfig, warnings?: string[]): ResolvedAccessory[] {
  const skipped = requestedSignalSwitches(config).length - MAX_SIGNAL_SWITCHES
  if (skipped > 0) {
    warnings?.push(`at most ${MAX_SIGNAL_SWITCHES} signal switches are created; ${skipped} skipped`)
  }
  return signalSwitches(config).map((signal) => ({
    kind: 'signal',
    name: signal.switchName,
    signal: { plugin: signal.plugin, signal: signal.signal },
  }))
}
