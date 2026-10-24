/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Regression coverage for config.schema.json and the package.json fields that
 * Homebridge Config UI X and verified review check. Invalid draft-07 (a
 * boolean `required` on a field) breaks the settings page for every user, and
 * a schema range that differs from the validator's lets the UI save a value
 * the plugin then rewrites with a warning.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as settings from '../../src/settings'
import { SEVERITIES } from '../../src/types'
import { ALERT_ID_PATTERN, ROUTING_KEY_PATTERN, SOURCE_PATTERN } from '../../src/utils/validators'

interface SchemaNode {
  type?: string
  required?: unknown
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  enum?: unknown[]
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  'x-schema-form'?: { type?: string }
}

interface ConfigSchema {
  pluginAlias: string
  pluginType: string
  singular?: boolean
  customUi?: boolean
  schema: SchemaNode & { properties: Record<string, SchemaNode> }
  layout?: LayoutItem[]
}

type LayoutItem = string | { key?: string; items?: LayoutItem[] }

interface PackageManifest {
  name?: string
  main?: string
  homepage?: string
  bugs?: { url?: string }
  keywords?: string[]
  scripts?: Record<string, string>
  engines?: { node?: string; homebridge?: string }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  files?: string[]
}

const ROOT = resolve(__dirname, '../..')
const schema = JSON.parse(readFileSync(join(ROOT, 'config.schema.json'), 'utf8')) as ConfigSchema
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageManifest
const props = schema.schema.properties
const alertItem = props.alerts!.items!
const levelItem = alertItem.properties!.levels!.items!

function walk(node: SchemaNode | undefined, visit: (node: SchemaNode, path: string) => void, path = '$'): void {
  if (node === undefined) {
    return
  }
  visit(node, path)
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    walk(child, visit, `${path}.${name}`)
  }
  walk(node.items, visit, `${path}[]`)
}

/** Layout key for every schema node, such as `alerts[].levels[].severity`. */
function schemaKeys(): { all: Set<string>; fields: string[] } {
  const all = new Set<string>()
  const fields: string[] = []
  walk(schema.schema, (node, path) => {
    if (path === '$') {
      return
    }
    const key = path.slice(2).replace(/\.\[\]/g, '[]')
    all.add(key)
    if (node.type !== 'object' && node.type !== 'array') {
      fields.push(key)
    }
  })
  return { all, fields }
}

function layoutKeys(items: LayoutItem[], keys: string[] = []): string[] {
  for (const item of items) {
    if (typeof item === 'string') {
      keys.push(item)
    } else {
      if (item.key !== undefined) {
        keys.push(item.key)
      }
      layoutKeys(item.items ?? [], keys)
    }
  }
  return keys
}

describe('config.schema.json', () => {
  it('declares the platform alias, singular, with no custom UI', () => {
    expect(schema.pluginAlias).toBe(settings.PLATFORM_NAME)
    expect(schema.pluginType).toBe('platform')
    expect(schema.singular).toBe(true)
    expect(schema.customUi).toBeUndefined()
  })

  it('requires exactly the platform name, so an empty config still loads', () => {
    expect(schema.schema.required).toEqual(['name'])
  })

  it('never declares `required` as a boolean (invalid draft-07)', () => {
    walk(schema.schema, (node, path) => {
      if ('required' in node) {
        expect([path, Array.isArray(node.required)]).toEqual([path, true])
      }
    })
  })

  it('requires the fields an alert and a level cannot be missing', () => {
    expect(alertItem.required).toEqual(['id', 'name', 'summary', 'levels'])
    expect(levelItem.required).toEqual(['severity'])
  })

  it('puts no default inside array items, so the UI cannot create a phantom entry', () => {
    walk(props.alerts, (node, path) => {
      if (path !== '$') {
        expect([path, node.default]).toEqual([path, undefined])
      }
    })
    walk(props.signals!.properties!.sources!.items, (node, path) => {
      expect([path, node.default]).toEqual([path, undefined])
    })
  })

  it('renders the routing key as a password with the validator\'s pattern', () => {
    expect(props.routingKey).toEqual(expect.objectContaining({
      'x-schema-form': { type: 'password' },
      pattern: ROUTING_KEY_PATTERN.source,
      minLength: 32,
      maxLength: 32,
    }))
  })

  it('uses the validator\'s patterns and enums', () => {
    expect(props.source!.pattern).toBe(SOURCE_PATTERN.source)
    expect(props.source!.default).toBe(settings.DEFAULT_SOURCE)
    expect(alertItem.properties!.id!.pattern).toBe(ALERT_ID_PATTERN.source)
    expect(props.region!.enum).toEqual(['us', 'eu'])
    expect(levelItem.properties!.severity!.enum).toEqual([...SEVERITIES])
  })

  it('uses the validator\'s ranges', () => {
    expect(props.alerts!.maxItems).toBe(settings.MAX_ALERTS)
    expect(alertItem.properties!.levels).toEqual(expect.objectContaining({ minItems: 1, maxItems: settings.MAX_LEVELS }))
    expect(alertItem.properties!.name!.maxLength).toBe(settings.MAX_NAME_LENGTH)
    expect(levelItem.properties!.name!.maxLength).toBe(settings.MAX_NAME_LENGTH)
    expect(alertItem.properties!.summary!.maxLength).toBe(settings.MAX_SUMMARY_LENGTH)
    expect(alertItem.properties!.resolveAfterMinutes).toEqual(expect.objectContaining({ minimum: 0, maximum: settings.MAX_RESOLVE_AFTER_MINUTES }))
    expect(props.maintenance!.properties!.maxMinutes).toEqual(expect.objectContaining({
      default: settings.DEFAULT_MAINTENANCE_MAX_MINUTES,
      minimum: settings.MIN_MAINTENANCE_MAX_MINUTES,
      maximum: settings.MAX_MAINTENANCE_MAX_MINUTES,
    }))
    expect(props.maintenance!.properties!.name).toEqual(expect.objectContaining({
      default: settings.DEFAULT_MAINTENANCE_NAME,
      maxLength: settings.MAX_NAME_LENGTH,
    }))
    expect(props.options!.properties!.deliveryFaultSensorName).toEqual(expect.objectContaining({
      default: settings.DEFAULT_DELIVERY_SENSOR_NAME,
      maxLength: settings.MAX_NAME_LENGTH,
    }))
  })

  it('declares diagnosticsInterval with the same default and range as settings', () => {
    expect(props.options!.properties!.diagnosticsInterval).toEqual(expect.objectContaining({
      default: settings.DEFAULT_DIAGNOSTICS_INTERVAL_SEC,
      minimum: 0,
      maximum: settings.MAX_DIAGNOSTICS_INTERVAL_SEC,
      'x-schema-form': { type: 'number' },
    }))
    expect(props.options!.properties!.structuredLogs).toEqual(expect.objectContaining({ type: 'boolean', default: false }))
  })

  it('places every setting in the layout once, because the UI hides any field the layout leaves out', () => {
    const { all, fields } = schemaKeys()
    const placed = layoutKeys(schema.layout ?? [])

    expect(placed.filter((key) => !all.has(key))).toEqual([])
    expect(fields.filter((key) => !placed.includes(key))).toEqual([])
    expect(placed.filter((key, index) => placed.indexOf(key) !== index)).toEqual([])
  })

  it('accepts the documented example signal reference and package name', () => {
    const signal = alertItem.properties!.signal!
    const source = props.signals!.properties!.sources!.items!

    expect(new RegExp(signal.pattern!).test('homebridge-example/sump-high')).toBe(true)
    expect(new RegExp(signal.pattern!).test('@scope/homebridge-example/sump-high')).toBe(true)
    expect(new RegExp(signal.pattern!).test('no-slash')).toBe(false)
    expect(new RegExp(source.pattern!).test('@scope/homebridge-example')).toBe(true)
  })
})

describe('package.json', () => {
  it('is named and built the way Homebridge loads it', () => {
    expect(manifest.name).toBe(settings.PLUGIN_NAME)
    expect(manifest.main).toBe('dist/index.js')
  })

  it('has an https homepage and a GitHub bugs url', () => {
    expect(manifest.homepage).toMatch(/^https:\/\//)
    expect(manifest.bugs?.url).toMatch(/^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/)
  })

  it('declares homebridge-plugin, a transport keyword, and more', () => {
    const keywords = manifest.keywords ?? []
    expect(keywords).toContain('homebridge-plugin')
    expect(keywords).toContain('supports-hap')
    expect(keywords.length).toBeGreaterThan(2)
  })

  it('has no install-time scripts', () => {
    for (const script of ['preinstall', 'install', 'postinstall']) {
      expect(manifest.scripts?.[script]).toBeUndefined()
    }
  })

  it('declares engines for Node 22.13+, 24 and 26, and Homebridge 2', () => {
    expect(manifest.engines?.node).toBe('^22.13.0 || ^24 || ^26')
    expect(manifest.engines?.homebridge).toMatch(/\^2/)
  })

  it('has no runtime dependencies at all', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
    expect(manifest.peerDependencies ?? {}).toEqual({})
  })

  it('does not ship strings that look like environment files or private keys', () => {
    const packed = listPacked(manifest.files ?? [])
    expect(packed.length).toBeGreaterThan(0)
    for (const file of packed) {
      const text = readFileSync(file, 'utf8')
      expect([file, /\.env\b/.test(text)]).toEqual([file, false])
      expect([file, /private[_-]?key/i.test(text)]).toEqual([file, false])
    }
  })
})

const PACKED_SOURCE = /\.(?:js|ts|json|md)$/

function listPacked(globs: string[]): string[] {
  const files: string[] = []
  for (const entry of globs) {
    collect(join(ROOT, entry.replace(/\/\*\*\/\*$/, '').replace(/\/\*\*$/, '')), files)
  }
  return files
}

function collect(path: string, files: string[]): void {
  let stats
  try {
    stats = statSync(path)
  } catch {
    return
  }
  if (stats.isFile()) {
    if (PACKED_SOURCE.test(path)) {
      files.push(path)
    }
    return
  }
  for (const name of readdirSync(path)) {
    collect(join(path, name), files)
  }
}
