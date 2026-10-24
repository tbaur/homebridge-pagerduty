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

import type { PagerDutyPlatformConfig, ResolvedConfig } from '../../../src/types'
import {
  defaultLevelName,
  resolveAccessories,
  resolveDiagnosticsIntervalSec,
  validateConfig,
} from '../../../src/utils/validators'
import { resolvedConfig } from '../../helpers/config'
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
      maintenance: { switch: false, maxMinutes: 240 },
      signalSources: [],
      options: { deliveryFaultSensor: true, dryRun: false, diagnosticsInterval: 0, structuredLogs: false },
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
    expect(low.config?.maintenance).toEqual({ switch: true, maxMinutes: 15 })
    expect(low.warnings).toEqual(['maintenance.maxMinutes clamped to 15'])

    expect(ok(base({ maintenance: { maxMinutes: 99_999 } })).maintenance.maxMinutes).toBe(10_080)
    expect(validateConfig(base({ maintenance: { maxMinutes: 'long' } })).warnings)
      .toEqual(['maintenance.maxMinutes is not a number; using 240'])
  })

  it('reads options', () => {
    const config = ok(base({ options: { deliveryFaultSensor: false, dryRun: true, diagnosticsInterval: 60, structuredLogs: true } }))

    expect(config.options).toEqual({ deliveryFaultSensor: false, dryRun: true, diagnosticsInterval: 60, structuredLogs: true })
  })
})

describe('validateConfig: signal sources', () => {
  it('keeps valid package names once each', () => {
    expect(ok(base({ signals: { sources: ['homebridge-example', '@scope/homebridge-x', 'homebridge-example'] } })).signalSources)
      .toEqual(['homebridge-example', '@scope/homebridge-x'])
  })

  it('skips an unusable entry, including this plugin itself', () => {
    const result = validateConfig(base({ signals: { sources: ['Bad Name', 'homebridge-pagerduty', 3] } }))

    expect(result.config?.signalSources).toEqual([])
    expect(result.warnings).toHaveLength(3)
  })

  it('warns about a sources value that is not a list', () => {
    expect(validateConfig(base({ signals: { sources: 'homebridge-example' } })).warnings)
      .toEqual(['signals.sources is not a list; the signal store stays closed'])
  })
})

describe('validateConfig: alerts', () => {
  it('resolves an alert with defaults', () => {
    expect(ok(base()).alerts).toEqual([{
      id: 'leak',
      name: 'Leak',
      summary: 'Water detected',
      levels: [{ severity: 'critical', name: 'Leak' }],
      resolveAfterMinutes: 0,
      bypassMaintenance: false,
    }])
  })

  it('names levels from the alert unless told otherwise', () => {
    const config = ok(base({
      alerts: [{ id: 'freezer', name: 'Freezer', summary: 's', levels: [{ severity: 'warning' }, { severity: 'critical', name: 'Freezer Hot' }] }],
    }))

    expect(config.alerts[0]!.levels).toEqual([
      { severity: 'warning', name: 'Freezer Warning' },
      { severity: 'critical', name: 'Freezer Hot' },
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
    ['a bad level name', { levels: [{ severity: 'info', name: '' }] }, 'level name is missing'],
    ['a bad timer', { resolveAfterMinutes: -1 }, 'resolveAfterMinutes must be a whole number from 0 to 10080'],
    ['a fractional timer', { resolveAfterMinutes: 1.5 }, 'resolveAfterMinutes must be a whole number'],
    ['a malformed signal', { signal: 'no-slash' }, 'signal must be <package>/<signal>'],
    ['a bound alert with two levels', { signal: 'homebridge-example/x', levels: [{ severity: 'info' }, { severity: 'error' }] }, 'an alert bound to a signal must have exactly one level'],
  ])('holds an alert with %s, keeping its accessories and state', (_name, patch, problem) => {
    const entry = { id: 'leak', name: 'Leak', summary: 'Water detected', levels: [{ severity: 'critical' }], ...patch }

    const result = validateConfig(base({ alerts: [entry] }))

    expect(result.status).toBe('ok')
    expect(result.config?.alerts).toEqual([])
    expect(result.config?.heldAlertIds).toEqual(['leak'])
    expect(result.warnings.join('\n')).toContain(problem)
    expect(result.warnings.join('\n')).toContain('alert leak is held until fixed')
  })

  it('binds an alert to a signal and warns when its package is not allowed', () => {
    const result = validateConfig(base({
      alerts: [{ id: 'sump', name: 'Sump', summary: 's', levels: [{ severity: 'error' }], signal: 'homebridge-example/sump-high', bypassMaintenance: true, resolveAfterMinutes: 30 }],
    }))

    expect(result.config?.alerts[0]).toEqual(expect.objectContaining({
      signal: { plugin: 'homebridge-example', signal: 'sump-high' }, bypassMaintenance: true, resolveAfterMinutes: 30,
    }))
    expect(result.warnings).toEqual(['alert sump is bound to homebridge-example, which is not in signals.sources; its row is never read'])
  })

  it('treats an empty signal as unbound', () => {
    expect(ok(base({ alerts: [{ id: 'a', name: 'A', summary: 's', levels: [{ severity: 'info' }], signal: '' }] })).alerts[0])
      .not.toHaveProperty('signal')
  })
})

describe('defaultLevelName', () => {
  it('uses the alert name for a single level', () => {
    expect(defaultLevelName('Leak', 'critical', 1)).toBe('Leak')
  })

  it('appends the severity, shortening a long name to fit HomeKit', () => {
    expect(defaultLevelName('Freezer', 'critical', 2)).toBe('Freezer Critical')

    const name = defaultLevelName('n'.repeat(64), 'warning', 2)
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

  it('leaves out the optional accessories when they are off', () => {
    const config = resolvedConfig({
      maintenance: { switch: false, maxMinutes: 240 },
      options: { deliveryFaultSensor: false, dryRun: false, diagnosticsInterval: 0, structuredLogs: false },
    })

    expect(resolveAccessories(config).map((entry) => entry.kind)).toEqual(['alert'])
  })

  it('warns once about duplicate names', () => {
    const config = resolvedConfig({ maintenance: { switch: false, maxMinutes: 240 } })
    config.alerts.push({ ...config.alerts[0]!, id: 'other' })
    const warnings: string[] = []

    resolveAccessories(config, warnings)

    expect(warnings).toEqual(['duplicate name: Zone One Leak (2)'])
  })
})
