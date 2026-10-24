/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The settings screen is built from what other plugins wrote. These tests pin
 * the two ways that can go wrong: a layout key Config UI X cannot resolve,
 * which blanks the whole screen, and another plugin's text reaching a place
 * that is rendered as markup.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildDynamicSchema, DynamicSchemaWriter, PLUGIN_SIGNALS_TITLE } from '../../src/dynamic-schema'
import type { CatalogEntry, ResolvedSignalPlugin } from '../../src/types'
import { allowedPlugin, signal } from '../helpers/config'
import { fakeLogger } from '../helpers/hap'

interface Node {
  title?: string
  default?: unknown
  description?: string
  required?: string[]
  properties?: Record<string, Node>
}

interface LayoutNode {
  key?: string
  title?: string
  htmlClass?: string
  items?: (string | LayoutNode)[]
  condition?: { functionBody: string }
}

interface Screen {
  dynamicSchemaVersion?: number
  schema: { properties: Record<string, Node> & { signals: Node } }
  layout: LayoutNode[]
}

const BASE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config.schema.json'), 'utf8')) as Record<string, unknown>

function build(catalog: CatalogEntry[], signalPlugins: ResolvedSignalPlugin[] = []): Screen {
  return buildDynamicSchema({ baseSchema: BASE, catalog, signalPlugins }) as unknown as Screen
}

function entry(plugin: string, name: string, summary = 'Plugin text'): CatalogEntry {
  return { plugin, signal: name, summary }
}

function pluginSignals(screen: Screen): Record<string, Node> {
  return screen.schema.properties.signals.properties ?? {}
}

function fieldset(screen: Screen): LayoutNode {
  return screen.layout.find((item) => item.title === PLUGIN_SIGNALS_TITLE)!
}

function layoutNodes(items: (string | LayoutNode)[]): (string | LayoutNode)[] {
  return items.flatMap((item) => [item, ...(typeof item === 'string' ? [] : layoutNodes(item.items ?? []))])
}

/** Resolve `signals["a"].signals["b"].summary` the way Config UI X does, against the schema. */
function resolveKey(screen: Screen, key: string): Node | undefined {
  const segments = [...key.matchAll(/(?:^|\.)([A-Za-z]+)|\[("(?:[^"\\]|\\.)*")\]/g)]
    .map((match) => match[1] ?? JSON.parse(match[2]!) as string)
  let node: Node | undefined = { properties: screen.schema.properties }
  for (const segment of segments) {
    node = node?.properties?.[segment]
  }
  return node
}

function condition(node: LayoutNode): (model: unknown) => boolean {
  return new Function('model', 'arrayIndices', node.condition!.functionBody) as (model: unknown) => boolean
}

describe('buildDynamicSchema', () => {
  it('copies the static schema, minus the version that would make Config UI X look for itself', () => {
    const screen = build([])

    expect(screen.dynamicSchemaVersion).toBeUndefined()
    expect(BASE.dynamicSchemaVersion).toBe(1)
    expect(Object.keys(screen.schema.properties)).toEqual(Object.keys((BASE.schema as { properties: object }).properties))
    expect(pluginSignals(screen)).toEqual({})
    expect(fieldset(screen).items).toEqual([])
  })

  it('lists every plugin that writes signals or is in config, in name order, with its signals', () => {
    const screen = build(
      [entry('homebridge-example', 'cloud-offline'), entry('homebridge-example', 'auth-failed'), entry('@scope/homebridge-x', 'a.b')],
      [allowedPlugin('homebridge-saved', [signal({ signal: 'kept' })])],
    )

    expect(Object.keys(pluginSignals(screen))).toEqual(['@scope:homebridge-x', 'homebridge-example', 'homebridge-saved'])
    expect(Object.keys(pluginSignals(screen)['homebridge-example']!.properties!.signals!.properties!)).toEqual(['auth-failed', 'cloud-offline'])
    expect(fieldset(screen).items!.map((item) => (item as LayoutNode).title)).toEqual(['@scope/homebridge-x', 'homebridge-example', 'homebridge-saved'])
  })

  it('offers the plugin text as the default title, and leaves it out when it would fail validation', () => {
    const screen = build([
      entry('homebridge-example', 'clean', '  Cloud is down  '),
      entry('homebridge-example', 'newline', 'Line one\nLine two'),
    ])
    const signals = pluginSignals(screen)['homebridge-example']!.properties!.signals!.properties!

    expect(signals.clean!.properties!.summary!.default).toBe('Cloud is down')
    expect(signals.newline!.properties!.summary).not.toHaveProperty('default')
    expect(signals.clean!.properties!.switchName!.default).toBe('Clean')
  })

  it('marks severity required, so the list offers no empty choice', () => {
    const screen = build([entry('homebridge-example', 'door')])
    const door = pluginSignals(screen)['homebridge-example']!.properties!.signals!.properties!.door!

    expect(door.required).toEqual(['severity'])
    expect(door.properties!.severity!.default).toBe('plugin')
  })

  it('never puts another plugin\'s text anywhere but a default value', () => {
    const hostile = '<img src=x onerror=alert(1)> {{ constructor }}'
    const screen = build([entry('homebridge-example', 'door', hostile)])
    const found: string[] = []
    const visit = (value: unknown, path: string): void => {
      if (value === hostile) {
        found.push(path)
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          visit(child, `${path}.${key}`)
        }
      }
    }

    visit(screen, '$')

    expect(found).toEqual(['$.schema.properties.signals.properties.homebridge-example.properties.signals.properties.door.properties.summary.default'])
  })

  it('gives every layout key a schema node, including scoped packages and dotted signal names', () => {
    const screen = build([entry('@scope/homebridge-x.y', 'a.b'), entry('homebridge-example', 'cloud-offline')])
    const keys = layoutNodes(fieldset(screen).items!)
      .map((item) => (typeof item === 'string' ? item : item.key))
      .filter((key): key is string => key !== undefined)

    expect(keys.length).toBeGreaterThan(10)
    for (const key of keys) {
      expect([key, resolveKey(screen, key) !== undefined]).toEqual([key, true])
    }
  })

  it('shows a plugin\'s signals once it is allowed, the switch name once the switch is on, and maintenance only with the switch', () => {
    const screen = build([entry('homebridge-example', 'door')])
    const plugin = fieldset(screen).items![0] as LayoutNode
    const door = plugin.items![1] as LayoutNode
    const find = (suffix: string): LayoutNode => door.items!.find((item) => typeof item !== 'string' && item.key!.endsWith(suffix)) as LayoutNode

    expect(plugin.items![0]).toBe('signals["homebridge-example"].allow')
    expect(condition(door)({})).toBe(false)
    expect(condition(door)({ signals: { 'homebridge-example': { allow: true } } })).toBe(true)
    expect(condition(find('.switchName'))({ signals: { 'homebridge-example': { signals: { door: { switch: true } } } } })).toBe(true)
    expect(condition(find('.switchName'))({})).toBe(false)
    expect(condition(find('.bypassMaintenance'))({ maintenance: { switch: true } })).toBe(true)
  })

  it('sets each plugin apart from the next section, and each signal apart from its plugin', () => {
    const screen = build([entry('homebridge-example', 'door')])
    const plugin = fieldset(screen).items![0] as LayoutNode
    const door = plugin.items![1] as LayoutNode

    expect(plugin.htmlClass).toContain('border')
    expect(door.htmlClass).toContain('border-start')
    expect(screen.layout.slice(1).map((section) => section.htmlClass)).toEqual(screen.layout.slice(1).map(() => 'border-top pt-3 mt-3'))
  })

  it('caps plugins and signals, keeping plugins from config first', () => {
    const catalog = [
      ...Array.from({ length: 25 }, (_unused, index) => entry(`homebridge-a${String(index).padStart(2, '0')}`, 'x')),
      ...Array.from({ length: 55 }, (_unused, index) => entry('homebridge-a00', `s${index}`)),
    ]

    const screen = build(catalog, [allowedPlugin('homebridge-z')])
    const plugins = Object.keys(pluginSignals(screen))

    expect(plugins).toHaveLength(20)
    expect(plugins).toContain('homebridge-z')
    expect(Object.keys(pluginSignals(screen)['homebridge-a00']!.properties!.signals!.properties!)).toHaveLength(50)
  })
})

describe('DynamicSchemaWriter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-screen-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the settings screen into the storage directory, owner-only', async () => {
    const writer = new DynamicSchemaWriter({ storageDir: dir, log: fakeLogger() })

    await writer.write({ catalog: [entry('homebridge-example', 'door')], signalPlugins: [] })

    const path = join(dir, '.homebridge-pagerduty-v1.schema.json')
    const screen = JSON.parse(readFileSync(path, 'utf8')) as Screen
    expect(Object.keys(pluginSignals(screen))).toEqual(['homebridge-example'])
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('writes one at a time, so the last write wins', async () => {
    const order: string[] = []
    const writer = new DynamicSchemaWriter({
      storageDir: dir,
      log: fakeLogger(),
      write: async (_path, value) => {
        await new Promise((resolve) => setImmediate(resolve))
        order.push(Object.keys(((value as Screen).schema.properties.signals.properties) ?? {}).join(','))
      },
    })

    void writer.write({ catalog: [entry('homebridge-first', 'x')], signalPlugins: [] })
    void writer.write({ catalog: [entry('homebridge-second', 'x')], signalPlugins: [] })
    await writer.flush()

    expect(order).toEqual(['homebridge-first', 'homebridge-second'])
  })

  it('logs a failure and keeps going', async () => {
    const log = fakeLogger()
    const writer = new DynamicSchemaWriter({
      storageDir: dir,
      log,
      readBaseSchema: () => {
        throw new Error('missing schema')
      },
    })

    await expect(writer.write({ catalog: [], signalPlugins: [] })).resolves.toBeUndefined()
    expect(log.lines('warn')).toEqual(['could not update the settings screen (missing schema); Plugin Signals may be out of date'])
  })
})
