/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The settings screen, rebuilt with a Plugin Signals section.
 *
 * `config.schema.json` sets `dynamicSchemaVersion`, so Config UI X reads the
 * file written here instead, from the storage directory. It is the static
 * schema plus one entry per plugin that writes signals or is in config.
 *
 * Everything another plugin wrote is untrusted. Names are limited to the
 * characters the signal store allows, which is what makes them safe in layout
 * keys and condition code. A plugin's text is only ever a field's default
 * value, never a title or description, which Config UI X renders as markup.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultSignalSwitchName, pluginConfigKey } from './signals/schema'
import {
  CONTROL_CHARACTERS,
  DYNAMIC_SCHEMA_FILE_NAME,
  MAX_NAME_LENGTH,
  MAX_SIGNAL_PLUGINS,
  MAX_SIGNALS_PER_PLUGIN,
  MAX_SUMMARY_LENGTH,
  PRIVATE_FILE_MODE,
  SEVERITY_FROM_PLUGIN,
} from './settings'
import type { CatalogEntry, PluginLogger, ResolvedSignalPlugin } from './types'
import { writeJsonAtomic } from './utils/atomic-file'
import { describeError } from './utils/errors'

/** Title of the layout fieldset this file fills. A test asserts the static schema has it. */
export const PLUGIN_SIGNALS_TITLE = 'Plugin Signals'

/** Bootstrap classes that Config UI X loads. A box per plugin and a rule per signal show what belongs to what. */
const PLUGIN_FIELDSET_CLASS = 'border rounded px-3 pt-3 pb-0 mb-3'
const SIGNAL_FIELDSET_CLASS = 'border-start border-2 ps-3 mb-2'

type JsonObject = Record<string, unknown>

/** What the settings screen is built from. */
export interface DynamicSchemaInput {
  /** `config.schema.json`, parsed. Not modified. */
  baseSchema: JsonObject
  catalog: readonly CatalogEntry[]
  signalPlugins: readonly ResolvedSignalPlugin[]
}

interface PluginEntry {
  plugin: string
  signals: { signal: string; summary?: string }[]
}

/** Build the settings screen. Pure. */
export function buildDynamicSchema(input: DynamicSchemaInput): JsonObject {
  const schema = structuredClone(input.baseSchema)
  delete schema.dynamicSchemaVersion
  const plugins = collectPlugins(input.catalog, input.signalPlugins)
  const properties = (schema.schema as { properties: JsonObject }).properties
  properties.signals = {
    title: PLUGIN_SIGNALS_TITLE,
    type: 'object',
    properties: Object.fromEntries(plugins.map((entry) => [pluginConfigKey(entry.plugin), pluginSchema(entry)])),
  }
  const fieldset = (schema.layout as JsonObject[]).find((item) => item.title === PLUGIN_SIGNALS_TITLE)
  if (fieldset !== undefined) {
    fieldset.items = plugins.map(pluginLayout)
  }
  return schema
}

/**
 * Plugins in config come first, so the cap never hides settings the user has
 * saved. Then plugins that write signals, in name order.
 */
function collectPlugins(catalog: readonly CatalogEntry[], configured: readonly ResolvedSignalPlugin[]): PluginEntry[] {
  const byPlugin = new Map<string, Map<string, string | undefined>>()
  for (const entry of configured) {
    byPlugin.set(entry.plugin, new Map(entry.signals.map((signal) => [signal.signal, undefined])))
  }
  for (const entry of [...catalog].sort(compareEntries)) {
    let signals = byPlugin.get(entry.plugin)
    if (signals === undefined && byPlugin.size < MAX_SIGNAL_PLUGINS) {
      signals = new Map()
      byPlugin.set(entry.plugin, signals)
    }
    if (signals !== undefined && (signals.has(entry.signal) || signals.size < MAX_SIGNALS_PER_PLUGIN)) {
      signals.set(entry.signal, cleanDefault(entry.summary))
    }
  }
  return [...byPlugin]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plugin, signals]) => ({
      plugin,
      signals: [...signals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([signal, summary]) => (summary === undefined ? { signal } : { signal, summary })),
    }))
}

function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  return a.plugin.localeCompare(b.plugin) || a.signal.localeCompare(b.signal)
}

/** A plugin's text as a default value, or undefined when it would not pass validation as a title. */
function cleanDefault(summary: string): string | undefined {
  const text = summary.trim()
  return text.length > 0 && text.length <= MAX_SUMMARY_LENGTH && !CONTROL_CHARACTERS.test(text) ? text : undefined
}

function pluginSchema(entry: PluginEntry): JsonObject {
  return {
    type: 'object',
    properties: {
      allow: {
        title: 'Allow this plugin to page',
        type: 'boolean',
        default: false,
        description: 'Only allow plugins that you trust. An allowed plugin can page you as often as it likes.',
      },
      signals: {
        type: 'object',
        properties: Object.fromEntries(entry.signals.map((signal) => [signal.signal, signalSchema(signal)])),
      },
    },
  }
}

function signalSchema(signal: { signal: string; summary?: string }): JsonObject {
  return {
    type: 'object',
    required: ['severity'],
    properties: {
      enabled: { title: 'Page for this signal', type: 'boolean', default: true },
      summary: {
        title: 'PagerDuty Message',
        type: 'string',
        maxLength: MAX_SUMMARY_LENGTH,
        ...(signal.summary === undefined ? {} : { default: signal.summary }),
        description: "Sent to PagerDuty when the plugin raises this signal. Leave blank to use the plugin's text.",
      },
      severity: {
        title: 'Severity',
        type: 'string',
        enum: [SEVERITY_FROM_PLUGIN, 'critical', 'error', 'warning', 'info'],
        default: SEVERITY_FROM_PLUGIN,
      },
      bypassMaintenance: {
        title: 'Page During Maintenance',
        type: 'boolean',
        default: false,
        description: 'Page even while the maintenance switch is on.',
      },
      switch: {
        title: 'Create HomeKit Switch',
        type: 'boolean',
        default: false,
        description: 'On while the signal is active. Turn it on by hand to page.',
      },
      switchName: {
        title: 'Switch Name',
        type: 'string',
        maxLength: MAX_NAME_LENGTH,
        default: defaultSignalSwitchName(signal.signal),
        description: 'The name that HomeKit shows. You can rename it at any time, and it keeps its room and automations.',
      },
    },
  }
}

function pluginLayout(entry: PluginEntry): JsonObject {
  const key = JSON.stringify(pluginConfigKey(entry.plugin))
  return {
    type: 'fieldset',
    title: entry.plugin,
    htmlClass: PLUGIN_FIELDSET_CLASS,
    expandable: true,
    expanded: false,
    items: [
      `signals[${key}].allow`,
      ...entry.signals.map((signal) => signalLayout(key, signal.signal)),
    ],
  }
}

function signalLayout(pluginKey: string, signal: string): JsonObject {
  const path = `signals[${pluginKey}].signals[${JSON.stringify(signal)}]`
  const model = `model.signals?.[${pluginKey}]`
  const settings = `${model}?.signals?.[${JSON.stringify(signal)}]`
  return {
    type: 'fieldset',
    title: signal,
    htmlClass: SIGNAL_FIELDSET_CLASS,
    expandable: true,
    expanded: false,
    condition: { functionBody: `return ${model}?.allow === true;` },
    items: [
      `${path}.enabled`,
      `${path}.summary`,
      {
        key: `${path}.severity`,
        type: 'select',
        titleMap: [
          { value: SEVERITY_FROM_PLUGIN, name: 'Set by the plugin' },
          { value: 'critical', name: 'Critical' },
          { value: 'error', name: 'Error' },
          { value: 'warning', name: 'Warning' },
          { value: 'info', name: 'Info' },
        ],
      },
      {
        key: `${path}.bypassMaintenance`,
        condition: { functionBody: 'return model.maintenance?.switch === true;' },
      },
      `${path}.switch`,
      {
        key: `${path}.switchName`,
        condition: { functionBody: `return ${settings}?.switch === true;` },
      },
    ],
  }
}

/** Construction options for {@link DynamicSchemaWriter}. */
export interface DynamicSchemaWriterOptions {
  storageDir: string
  log: PluginLogger
  /** Defaults to `config.schema.json` in the package root. */
  readBaseSchema?: () => JsonObject
  write?: (path: string, value: unknown) => Promise<void>
}

/**
 * Writes the settings screen, one write at a time. A failed write is logged
 * and changes nothing else: the settings screen is a convenience, and paging
 * never depends on it.
 */
export class DynamicSchemaWriter {
  private readonly options: DynamicSchemaWriterOptions
  private pending: Promise<void> = Promise.resolve()

  constructor(options: DynamicSchemaWriterOptions) {
    this.options = options
  }

  /** Resolves once every queued write has finished. Never rejects. */
  flush(): Promise<void> {
    return this.pending
  }

  /** Queue a write. The returned promise never rejects. */
  write(input: Omit<DynamicSchemaInput, 'baseSchema'>): Promise<void> {
    this.pending = this.pending.then(() => this.writeNow(input))
    return this.pending
  }

  private async writeNow(input: Omit<DynamicSchemaInput, 'baseSchema'>): Promise<void> {
    const path = join(this.options.storageDir, DYNAMIC_SCHEMA_FILE_NAME)
    try {
      const baseSchema = (this.options.readBaseSchema ?? readBaseSchema)()
      const schema = buildDynamicSchema({ ...input, baseSchema })
      await (this.options.write ?? writeSchemaFile)(path, schema)
    } catch (error) {
      this.options.log.warn(`could not update the settings screen (${describeError(error)}); Plugin Signals may be out of date`)
    }
  }
}

function readBaseSchema(): JsonObject {
  return JSON.parse(readFileSync(join(__dirname, '..', 'config.schema.json'), 'utf8')) as JsonObject
}

function writeSchemaFile(path: string, value: unknown): Promise<void> {
  return writeJsonAtomic(path, value, PRIVATE_FILE_MODE)
}
