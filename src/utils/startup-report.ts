/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The configuration report logged once at startup.
 *
 * One line for the platform, then one line per alert and per optional
 * accessory, so the log shows what is running without opening config.json.
 * The routing key never appears.
 */

import { allowedPlugins, signalSettings } from '../signals/config'
import type { CatalogEntry, ResolvedAccessory, ResolvedConfig } from '../types'
import { forLog } from './redact'

/** What changed while the accessories were synced with the cache. */
export interface AccessoryChanges {
  /** Created on this start rather than restored from the cache. */
  created: ReadonlySet<ResolvedAccessory>
  /** Restored under a different name. The value is the old name. */
  renamed: ReadonlyMap<ResolvedAccessory, string>
}

/** What the startup report is built from. */
export interface StartupReportInput {
  config: ResolvedConfig
  accessories: readonly ResolvedAccessory[]
  pluginVersion: string
  changes: AccessoryChanges
  /** Every plugin's signals from the first store read. Undefined leaves the signal lines out. */
  catalog?: readonly CatalogEntry[]
}

/** Longest signal list printed for one plugin; the rest are counted. */
const MAX_LISTED_SIGNALS = 20

/** Build the startup report, one log line per entry. */
export function formatStartupReport(input: StartupReportInput): string[] {
  const { config, accessories, changes } = input
  const lines = [platformLine(input)]
  for (const alert of config.alerts) {
    const switches = accessories.filter((accessory) => accessory.kind === 'alert' && accessory.alertId === alert.id)
    const notes = [
      alert.levels.map((level) => level.severity).join(', '),
      ...newNotes(switches, changes),
      ...renameNotes(switches, changes),
    ]
    lines.push(`Alert switch: ${alert.id} "${forLog(alert.summary)}" (${notes.join('; ')})`)
  }
  for (const id of config.heldAlertIds) {
    lines.push(`Alert switch: ${id} held until its entry is fixed; its switches show No Response`)
  }
  if (input.catalog !== undefined) {
    for (const [plugin, written] of signalsByPlugin(input.catalog, config)) {
      lines.push(signalLine(plugin, written, config))
    }
  }
  for (const accessory of accessories) {
    if (accessory.kind === 'signal' && accessory.signal !== undefined) {
      lines.push(`Signal switch: ${nameOf(accessory, changes)} for ${accessory.signal.plugin}/${accessory.signal.signal}`)
    } else if (accessory.kind === 'maintenance') {
      lines.push(`Maintenance switch: ${nameOf(accessory, changes)}; turns off after ${config.maintenance.maxMinutes} min`)
    } else if (accessory.kind === 'delivery') {
      lines.push(`Delivery sensor: ${nameOf(accessory, changes)}`)
    }
  }
  return lines
}

function platformLine({ config, pluginVersion }: StartupReportInput): string {
  const parts = [`region ${config.region.toUpperCase()}`, `source ${config.source}`]
  const allowed = allowedPlugins(config).length
  if (allowed > 0) {
    parts.push(`plugins allowed ${allowed}`)
  }
  const mode = config.options.dryRun ? ' (dry run: nothing is sent)' : ''
  return `Starting v${pluginVersion}${mode}: ${parts.join(', ')}`
}

/** Signal names by plugin, for every plugin that writes signals or is allowed. */
function signalsByPlugin(catalog: readonly CatalogEntry[], config: ResolvedConfig): Map<string, string[]> {
  const grouped = new Map<string, string[]>(allowedPlugins(config).map((plugin) => [plugin, []]))
  for (const entry of catalog) {
    grouped.set(entry.plugin, [...grouped.get(entry.plugin) ?? [], entry.signal])
  }
  return new Map([...grouped].sort(([a], [b]) => a.localeCompare(b)))
}

/** What a plugin has written, and whether anything it writes can page. */
function signalLine(plugin: string, written: readonly string[], config: ResolvedConfig): string {
  const parts = [written.length > 0 ? listSignals(written) : 'none written yet']
  if (!allowedPlugins(config).includes(plugin)) {
    parts.push('not allowed, so nothing is paged')
  } else {
    const muted = written.filter((signal) => signalSettings(config, { plugin, signal })?.enabled === false)
    if (muted.length > 0) {
      parts.push(`muted: ${listSignals(muted)}`)
    }
  }
  return `Signals from ${plugin}: ${parts.join('; ')}`
}

function listSignals(names: readonly string[]): string {
  const listed = names.slice(0, MAX_LISTED_SIGNALS).map(forLog).join(', ')
  const rest = names.length - MAX_LISTED_SIGNALS
  return rest > 0 ? `${listed} and ${rest} more` : listed
}

/** `new` when every switch was created on this start, otherwise the names of the ones that were. */
function newNotes(switches: readonly ResolvedAccessory[], changes: AccessoryChanges): string[] {
  const created = switches.filter((accessory) => changes.created.has(accessory))
  if (created.length === 0) {
    return []
  }
  if (created.length === switches.length) {
    return ['new']
  }
  return [`new ${created.map((accessory) => forLog(accessory.name)).join(', ')}`]
}

function renameNotes(switches: readonly ResolvedAccessory[], changes: AccessoryChanges): string[] {
  const renames = switches.flatMap((accessory) => {
    const oldName = changes.renamed.get(accessory)
    return oldName === undefined ? [] : [`${forLog(oldName)} to ${forLog(accessory.name)}`]
  })
  return renames.length > 0 ? [`renamed ${renames.join(', ')}`] : []
}

function nameOf(accessory: ResolvedAccessory, changes: AccessoryChanges): string {
  const name = forLog(accessory.name)
  const oldName = changes.renamed.get(accessory)
  if (oldName !== undefined) {
    return `${name} (renamed from ${forLog(oldName)})`
  }
  return changes.created.has(accessory) ? `${name} (new)` : name
}
