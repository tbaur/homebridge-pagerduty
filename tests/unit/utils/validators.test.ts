/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Validation decides what a mistake in config.json costs. The expensive
 * outcomes are the ones pinned here: a typo must never resolve a live
 * incident, delete a tile, or put the routing key into a log line.
 */

import type { PagerDutyPlatformConfig, ResolvedConfig, SignalPluginConfig } from '../../../src/types'
import {
  levelSwitchName,
  resolveAccessories,
  resolveDiagnosticsIntervalSec,
  validateConfig,
} from '../../../src/utils/validators'
import { allowedPlugin, resolvedConfig, signal } from '../../helpers/config'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

function base(overrides: Partial<PagerDutyPlatformConfig> = {}): PagerDutyPlatformConfig {
  return {
    platform: 'PagerDuty',
    name: 'PagerDuty',
    routingKey: FAKE_ROUTING_KEY,
    alerts: [{ id: 'leak', name: 'Leak', summary: 'Water detected', levels: [{ severity: 'critical' }] }],
    ...overrides,
  }
}

function ok(raw: unknown): ResolvedConfig {
  const result = validateConfig(raw)
  if (result.status !== 'ok' || result.config === undefined) {
    throw new Error(`expected ok, got ${result.status}: ${result.errors.join('; ')}`)
  }
  return result.config
}

describe('validateConfig: the routing key', () => {
  it.each([[undefined], [null], [''], ['   ']])('treats %p as not configured', (routingKey) => {
    const result = validateConfig(base({ routingKey }))

    expect(result.status).toBe('notConfigured')
    expect(result.errors).toEqual([])
  })

  it('rejects a key of the wrong shape without quoting it', () => {
    const result = validateConfig(base({ routingKey: 'short-key-value' }))

    expect(result.status).toBe('invalid')
    expect(result.errors).toEqual(['routingKey is not a 32-character PagerDuty integration key'])
    expect(JSON.stringify(result)).not.toContain('short-key-value')
  })

  it('rejects a key that is not a string', () => {
    expect(validateConfig(base({ routingKey: 42 })).errors).toEqual(['routingKey must be a string'])
  })

  it('trims a pasted key and says so without quoting it', () => {
    const result = validateConfig(base({ routingKey: `  ${FAKE_ROUTING_KEY}\n` }))

    expect(result.config?.routingKey).toBe(FAKE_ROUTING_KEY)
    expect(result.warnings).toEqual(['routingKey had surrounding whitespace; trimmed'])
    expect(JSON.stringify(result.warnings)).not.toContain(FAKE_ROUTING_KEY)
  })

  it('rejects a missing platform block', () => {
    expect(validateConfig(undefined)).toEqual({ status: 'invalid', errors: ['platform configuration is missing'], warnings: [] })
  })
})

describe('validateConfig: platform fields', () => {
  it('fills in defaults', () => {
    const config = ok(base({ alerts: undefined }))

    expect(config).toEqual(expect.objectContaining({
      region: 'us',
      source: 'homebridge',
      alerts: [],
      heldAlertIds: [],
      maintenance: { switch: false, name: 'PagerDuty Maintenance', maxMinutes: 240 },
      signalPlugins: [],
      options: {
        deliveryFaultSensor: true,
        deliveryFaultSensorName: 'PagerDuty Delivery',
        dryRun: false,
        diagnosticsInterval: 0,
        structuredLogs: false,
      },
    }))
  })

  it('accepts the eu region and falls back to us for anything else', () => {
    expect(ok(base({ region: 'eu' })).region).toBe('eu')

    const result = validateConfig(base({ region: 'apac' }))
    expect(result.config?.region).toBe('us')
    expect(result.warnings).toEqual(['region apac is not us or eu; using us'])
  })

  it('makes a bad source fatal, because it is part of every dedup key', () => {
    expect(validateConfig(base({ source: 'has space' })).status).toBe('invalid')
    expect(validateConfig(base({ source: 7 })).status).toBe('invalid')
    expect(ok(base({ source: 'cabin.v2' })).source).toBe('cabin.v2')
  })

  it('clamps maintenance.maxMinutes into range and defaults a non-number', () => {
    const low = validateConfig(base({ maintenance: { switch: true, maxMinutes: 1 } }))
    expect(low.config?.maintenance).toEqual({ switch: true, name: 'PagerDuty Maintenance', maxMinutes: 15 })
    expect(low.warnings).toEqual(['maintenance.maxMinutes clamped to 15'])

    expect(ok(base({ maintenance: { maxMinutes: 99_999 } })).maintenance.maxMinutes).toBe(10_080)
    expect(validateConfig(base({ maintenance: { maxMinutes: 'long' } })).warnings)
      .toEqual(['maintenance.maxMinutes is not a number; using 240'])
  })

  it('reads options', () => {
    const options = {
      deliveryFaultSensor: false,
      deliveryFaultSensorName: 'Paging Health',
      dryRun: true,
      diagnosticsInterval: 60,
      structuredLogs: true,
    }

    expect(ok(base({ options })).options).toEqual(options)
  })

  it('trims user-chosen names for the maintenance switch and delivery sensor', () => {
    const config = ok(base({
      maintenance: { switch: true, name: '  House Work  ' },
      options: { deliveryFaultSensorName: ' Paging Health ' },
    }))

    expect(config.maintenance.name).toBe('House Work')
    expect(config.options.deliveryFaultSensorName).toBe('Paging Health')
  })

  it('keeps the default name for a blank one, and warns about an unusable one', () => {
    expect(ok(base({ maintenance: { name: '   ' } })).maintenance.name).toBe('PagerDuty Maintenance')

    const result = validateConfig(base({
      maintenance: { name: 'x'.repeat(65) },
      options: { deliveryFaultSensorName: 7 },
    }))
    expect(result.config?.maintenance.name).toBe('PagerDuty Maintenance')
    expect(result.config?.options.deliveryFaultSensorName).toBe('PagerDuty Delivery')
    expect(result.warnings).toEqual([
      'maintenance.name is longer than 64 characters; using PagerDuty Maintenance',
      'options.deliveryFaultSensorName is not text; using PagerDuty Delivery',
    ])
    expect(validateConfig(base({ maintenance: { name: 'Bad\nName' } })).warnings)
      .toEqual(['maintenance.name contains control characters; using PagerDuty Maintenance'])
  })
})

describe('validateConfig: plugin signals', () => {
  const settings = (patch: Record<string, unknown>): PagerDutyPlatformConfig => base({
    signals: { 'homebridge-example': { allow: true, signals: { 'cloud-offline': patch } } },
  })

  it('resolves an untouched signal to the plugin\'s own settings', () => {
    expect(ok(settings({})).signalPlugins).toEqual([{
      plugin: 'homebridge-example',
      allow: true,
      signals: [{
        plugin: 'homebridge-example',
        signal: 'cloud-offline',
        enabled: true,
        bypassMaintenance: false,
        switch: false,
        switchName: 'Cloud Offline',
      }],
    }])
  })

  it('resolves every setting a user can change', () => {
    const patch = { enabled: false, summary: '  Cloud is down  ', severity: 'error', bypassMaintenance: true, switch: true, switchName: 'Example Cloud' }

    expect(ok(settings(patch)).signalPlugins[0]!.signals[0]).toEqual({
      plugin: 'homebridge-example',
      signal: 'cloud-offline',
      enabled: false,
      summary: 'Cloud is down',
      severity: 'error',
      bypassMaintenance: true,
      switch: true,
      switchName: 'Example Cloud',
    })
  })

  it('treats a blank title and the plugin severity as no override', () => {
    const signal = ok(settings({ summary: '  ', severity: 'plugin' })).signalPlugins[0]!.signals[0]!

    expect(signal).not.toHaveProperty('summary')
    expect(signal).not.toHaveProperty('severity')
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a title that is not text', { summary: 5 }, 'signals.homebridge-example.signals.cloud-offline.summary is not text; using the plugin\'s text'],
    ['a title with a newline', { summary: 'a\nb' }, 'signals.homebridge-example.signals.cloud-offline.summary contains control characters; using the plugin\'s text'],
    ['a title that is too long', { summary: 's'.repeat(1025) }, 'signals.homebridge-example.signals.cloud-offline.summary is longer than 1024 characters; using the plugin\'s text'],
    ['a bad severity', { severity: 'urgent' }, 'signals.homebridge-example.signals.cloud-offline.severity urgent is not a severity; using the plugin\'s'],
    ['a bad switch name', { switchName: 'a\u0007b' }, 'signals.homebridge-example.signals.cloud-offline.switchName contains control characters; using Cloud Offline'],
  ])('warns about %s and keeps the plugin\'s value', (_name, patch, warning) => {
    const result = validateConfig(settings(patch))

    expect(result.status).toBe('ok')
    expect(result.warnings).toEqual([warning])
  })

  it('maps a scoped package back from its config key', () => {
    expect(ok(base({ signals: { '@scope:homebridge-x': { allow: true } } })).signalPlugins)
      .toEqual([{ plugin: '@scope/homebridge-x', allow: true, signals: [] }])
  })

  it('keeps a plugin that is not allowed, so its saved settings survive', () => {
    expect(ok(base({ signals: { 'homebridge-example': { signals: { door: {} } } } })).signalPlugins[0])
      .toEqual(expect.objectContaining({ plugin: 'homebridge-example', allow: false }))
  })

  it('skips unusable keys and entries without failing the config', () => {
    const result = validateConfig(base({
      signals: {
        'Bad Name': { allow: true },
        'homebridge-pagerduty': { allow: true },
        'a:b:c': { allow: true },
        'homebridge-list': [],
        'homebridge-example': { allow: true, signals: { 'Bad Signal': {}, door: 'yes', window: {} } },
        '@scope:homebridge-x': { allow: true },
        '@scope/homebridge-x': { allow: true },
      },
    }))

    expect(result.status).toBe('ok')
    expect(result.config?.signalPlugins.map((entry) => entry.plugin)).toEqual(['homebridge-example', '@scope/homebridge-x'])
    expect(result.config?.signalPlugins[0]!.signals.map((entry) => entry.signal)).toEqual(['window'])
    expect(result.warnings).toEqual([
      'signals: Bad Name is not a package name with settings; skipped',
      'signals: homebridge-pagerduty is not a package name with settings; skipped',
      'signals: a:b:c is not a package name with settings; skipped',
      'signals: homebridge-list is not a package name with settings; skipped',
      'signals.homebridge-example: Bad Signal is not a signal name with settings; skipped',
      'signals.homebridge-example: door is not a signal name with settings; skipped',
      'signals: @scope/homebridge-x appears twice; the second entry is skipped',
    ])
  })

  it('warns about a signals value that is not an object, and a signals list that is not one either', () => {
    expect(validateConfig(base({ signals: ['homebridge-example'] })).warnings).toEqual(['signals is not an object; no plugin may page'])
    expect(validateConfig(base({ signals: { 'homebridge-example': { allow: true, signals: [] } } })).warnings)
      .toEqual(['signals.homebridge-example.signals is not an object; its signals use the plugin\'s settings'])
  })

  it('caps the number of plugins and of signals per plugin', () => {
    const plugins: Record<string, SignalPluginConfig> = Object.fromEntries(Array.from({ length: 21 }, (_unused, index) => [`homebridge-p${index}`, { allow: true }]))
    const signals = Object.fromEntries(Array.from({ length: 51 }, (_unused, index) => [`s${index}`, {}]))
    plugins['homebridge-p0'] = { allow: true, signals }

    const result = validateConfig(base({ signals: plugins }))

    expect(result.config?.signalPlugins).toHaveLength(20)
    expect(result.config?.signalPlugins[0]!.signals).toHaveLength(50)
    expect(result.warnings).toEqual([
      'signals.homebridge-p0: at most 50 signals are read; s50 skipped',
      'signals: at most 20 plugins are read; homebridge-p20 skipped',
    ])
  })
})

describe('validateConfig: alerts', () => {
  it('resolves an alert with defaults', () => {
    expect(ok(base()).alerts).toEqual([{
      id: 'leak',
      name: 'Leak',
      summary: 'Water detected',
      levels: [{ severity: 'critical', name: 'Leak Critical' }],
      resolveAfterMinutes: 0,
      bypassMaintenance: false,
    }])
  })

  it('names each switch with the prefix and its severity', () => {
    const config = ok(base({
      alerts: [{ id: 'freezer', name: 'Freezer', summary: 's', levels: [{ severity: 'warning' }, { severity: 'critical' }] }],
    }))

    expect(config.alerts[0]!.levels).toEqual([
      { severity: 'warning', name: 'Freezer Warning' },
      { severity: 'critical', name: 'Freezer Critical' },
    ])
  })

  it('makes alerts a fatal error when it is not a list or is too long', () => {
    expect(validateConfig(base({ alerts: {} })).errors).toEqual(['alerts must be a list'])

    const many = Array.from({ length: 31 }, (_unused, index) => ({ id: `a${index}`, name: 'n', summary: 's', levels: [{ severity: 'info' }] }))
    expect(validateConfig(base({ alerts: many })).errors).toEqual(['at most 30 alerts are supported; found 31'])
  })

  it('skips an entry with no usable id, and a non-object', () => {
    const result = validateConfig(base({ alerts: [{ id: 'Bad Id', name: 'x' }, 'leak', null] }))

    expect(result.config?.alerts).toEqual([])
    expect(result.config?.heldAlertIds).toEqual([])
    expect(result.warnings).toHaveLength(3)
  })

  it('skips a duplicate id, keeping the first', () => {
    const result = validateConfig(base({
      alerts: [
        { id: 'leak', name: 'First', summary: 's', levels: [{ severity: 'critical' }] },
        { id: 'leak', name: 'Second', summary: 's', levels: [{ severity: 'critical' }] },
      ],
    }))

    expect(result.config?.alerts.map((entry) => entry.name)).toEqual(['First'])
    expect(result.warnings).toEqual(['alerts[1] repeats id leak; skipping the duplicate'])
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a missing name', { name: undefined }, 'name is missing'],
    ['a name with a newline', { name: 'Leak\nforged' }, 'name contains control characters'],
    ['a name that is too long', { name: 'n'.repeat(65) }, 'name is longer than 64 characters'],
    ['a summary that is too long', { summary: 's'.repeat(1025) }, 'summary is longer than 1024 characters'],
    ['no levels', { levels: [] }, 'levels must list 1 to 4 entries'],
    ['too many levels', { levels: [{ severity: 'info' }, { severity: 'warning' }, { severity: 'error' }, { severity: 'critical' }, { severity: 'info' }] }, 'levels must list 1 to 4 entries'],
    ['a repeated severity', { levels: [{ severity: 'info' }, { severity: 'info' }] }, 'each level needs a distinct severity'],
    ['a bad severity', { levels: [{ severity: 'urgent' }] }, 'each level needs a distinct severity'],
    ['a non-object level', { levels: ['critical'] }, 'each level needs a distinct severity'],
    ['a bad timer', { resolveAfterMinutes: -1 }, 'resolveAfterMinutes must be a whole number from 0 to 10080'],
    ['a fractional timer', { resolveAfterMinutes: 1.5 }, 'resolveAfterMinutes must be a whole number'],
  ])('holds an alert with %s, keeping its accessories and state', (_name, patch, problem) => {
    const entry = { id: 'leak', name: 'Leak', summary: 'Water detected', levels: [{ severity: 'critical' }], ...patch }

    const result = validateConfig(base({ alerts: [entry] }))

    expect(result.status).toBe('ok')
    expect(result.config?.alerts).toEqual([])
    expect(result.config?.heldAlertIds).toEqual(['leak'])
    expect(result.warnings.join('\n')).toContain(problem)
    expect(result.warnings.join('\n')).toContain('alert leak is held until fixed')
  })
})

describe('levelSwitchName', () => {
  it('appends the severity, shortening a long prefix to fit HomeKit', () => {
    expect(levelSwitchName('Leak', 'critical')).toBe('Leak Critical')

    const name = levelSwitchName('n'.repeat(64), 'warning')
    expect(name).toHaveLength(64)
    expect(name.endsWith('\u2026 Warning')).toBe(true)
  })
})

describe('resolveDiagnosticsIntervalSec', () => {
  it.each<[unknown, number]>([
    [undefined, 0], [0, 0], [0.2, 0], [1, 30], [29, 30], [30, 30], [600, 600], ['120', 120], [99_999, 3_600],
  ])('maps %p to %p', (value, expected) => {
    expect(resolveDiagnosticsIntervalSec(value)).toBe(expected)
  })

  it('turns diagnostics off for an unusable value and says so', () => {
    const warnings: string[] = []

    expect(resolveDiagnosticsIntervalSec(-5, warnings)).toBe(0)
    expect(resolveDiagnosticsIntervalSec('often', warnings)).toBe(0)
    expect(warnings).toHaveLength(2)
  })
})

describe('resolveAccessories', () => {
  it('lists a switch per level, then maintenance, then delivery', () => {
    const config = resolvedConfig()

    expect(resolveAccessories(config)).toEqual([
      { kind: 'alert', name: 'Zone One Leak', alertId: 'leak', severity: 'critical' },
      { kind: 'maintenance', name: 'PagerDuty Maintenance' },
      { kind: 'delivery', name: 'PagerDuty Delivery' },
    ])
  })

  it('uses the configured names for the maintenance switch and delivery sensor', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      maintenance: { ...base.maintenance, name: 'House Work' },
      options: { ...base.options, deliveryFaultSensorName: 'Paging Health' },
    })

    expect(resolveAccessories(config).slice(1)).toEqual([
      { kind: 'maintenance', name: 'House Work' },
      { kind: 'delivery', name: 'Paging Health' },
    ])
  })

  it('leaves out the optional accessories when they are off', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      maintenance: { ...base.maintenance, switch: false },
      options: { ...base.options, deliveryFaultSensor: false },
    })

    expect(resolveAccessories(config).map((entry) => entry.kind)).toEqual(['alert'])
  })

  it('warns once about duplicate names', () => {
    const config = resolvedConfig()
    config.maintenance.switch = false
    config.alerts.push({ ...config.alerts[0]!, id: 'other' })
    const warnings: string[] = []

    resolveAccessories(config, warnings)

    expect(warnings).toEqual(['duplicate name: Zone One Leak (2)'])
  })

  it('adds a switch for each allowed, enabled signal that asks for one, before maintenance', () => {
    const config = resolvedConfig({
      signalPlugins: [
        allowedPlugin('homebridge-example', [
          signal({ signal: 'door', switch: true, switchName: 'Zone Two' }),
          signal({ signal: 'muted', switch: true, enabled: false }),
          signal({ signal: 'quiet' }),
        ]),
        { plugin: 'homebridge-off', allow: false, signals: [signal({ plugin: 'homebridge-off', signal: 'x', switch: true })] },
      ],
    })

    expect(resolveAccessories(config).filter((entry) => entry.kind === 'signal')).toEqual([
      { kind: 'signal', name: 'Zone Two', signal: { plugin: 'homebridge-example', signal: 'door' } },
    ])
    expect(resolveAccessories(config).map((entry) => entry.kind)).toEqual(['alert', 'signal', 'maintenance', 'delivery'])
  })

  it('caps signal switches and says how many were skipped', () => {
    const signals = Array.from({ length: 22 }, (_unused, index) => signal({ signal: `s${index}`, switch: true, switchName: `S${index}` }))
    const warnings: string[] = []

    const accessories = resolveAccessories(resolvedConfig({ signalPlugins: [allowedPlugin('homebridge-example', signals)] }), warnings)

    expect(accessories.filter((entry) => entry.kind === 'signal')).toHaveLength(20)
    expect(warnings).toEqual(['at most 20 signal switches are created; skipped homebridge-example/s20, homebridge-example/s21'])
  })

  it('names at most five skipped signal switches', () => {
    const signals = Array.from({ length: 27 }, (_unused, index) => signal({ signal: `s${index}`, switch: true }))
    const warnings: string[] = []

    resolveAccessories(resolvedConfig({ signalPlugins: [allowedPlugin('homebridge-example', signals)] }), warnings)

    expect(warnings[0]).toMatch(/skipped homebridge-example\/s20, .*homebridge-example\/s24 and 2 more$/)
  })
})
