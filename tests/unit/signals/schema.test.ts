/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The signal store schema is a published interface: other plugins run this
 * exact text. Row validation is the second line of defence when a writer
 * created the table with something else.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  defaultSignalSwitchName,
  isAllowableSource,
  isValidPluginName,
  isValidSignalName,
  parseSignalRef,
  pluginConfigKey,
  pluginFromConfigKey,
  SIGNAL_SCHEMA_SQL,
  signalRefKey,
  validateCatalogEntry,
  validateRow,
} from '../../../src/signals/schema'

describe('names', () => {
  it.each(['homebridge-example', '@scope/homebridge-example', 'a', 'x.y_z-1'])('accepts package name %p', (name) => {
    expect(isValidPluginName(name)).toBe(true)
  })

  it.each(['', 'Upper', 'has space', '@scope', '@/x', '-lead', 'p'.repeat(129), 7])('rejects package name %p', (name) => {
    expect(isValidPluginName(name)).toBe(false)
  })

  it('never allows this plugin to be its own source', () => {
    expect(isAllowableSource('homebridge-pagerduty')).toBe(false)
    expect(isAllowableSource('homebridge-example')).toBe(true)
  })

  it('checks signal names', () => {
    expect(isValidSignalName('sump-high')).toBe(true)
    expect(isValidSignalName('a/b')).toBe(false)
    expect(isValidSignalName('x'.repeat(65))).toBe(false)
    expect(isValidSignalName(undefined)).toBe(false)
  })
})

describe('parseSignalRef', () => {
  it('splits at the last slash, so a scoped package works', () => {
    expect(parseSignalRef('@scope/homebridge-example/sump-high')).toEqual({ plugin: '@scope/homebridge-example', signal: 'sump-high' })
    expect(signalRefKey({ plugin: 'homebridge-example', signal: 'x' })).toBe('homebridge-example/x')
  })

  it.each([['no-slash'], ['/leading'], ['pkg/'], ['Pkg/x'], [5]])('rejects %p', (value) => {
    expect(parseSignalRef(value)).toBeUndefined()
  })
})

describe('validateRow', () => {
  const row = { plugin: 'homebridge-example', signal: 'door', active: 1, severity: 'warning', summary: 'Door open', updated_at: 5 }

  it('accepts a row, including bigint integers', () => {
    expect(validateRow(row)).toEqual({ plugin: 'homebridge-example', signal: 'door', active: true, severity: 'warning', summary: 'Door open', updatedAt: 5 })
    expect(validateRow({ ...row, active: BigInt(0), updated_at: BigInt(9) })).toEqual(expect.objectContaining({ active: false, updatedAt: 9 }))
  })

  it.each<[string, Record<string, unknown>]>([
    ['a bad plugin', { plugin: 'Bad' }],
    ['a bad signal', { signal: 'a/b' }],
    ['a bad severity', { severity: 'urgent' }],
    ['active out of range', { active: 2 }],
    ['an empty summary', { summary: '' }],
    ['a long summary', { summary: 's'.repeat(1025) }],
    ['a non-numeric time', { updated_at: 'now' }],
    ['an infinite time', { updated_at: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_name, patch) => {
    expect(validateRow({ ...row, ...patch })).toBeUndefined()
  })
})

describe('config keys', () => {
  it('stores a scoped package under a key without a slash, and maps it back', () => {
    expect(pluginConfigKey('@scope/homebridge-example')).toBe('@scope:homebridge-example')
    expect(pluginConfigKey('homebridge-example')).toBe('homebridge-example')
    expect(pluginFromConfigKey('@scope:homebridge-example')).toBe('@scope/homebridge-example')
    expect(pluginFromConfigKey('homebridge-example')).toBe('homebridge-example')
  })

  it.each(['homebridge-pagerduty', 'a:b', 'a:b:c', 'Bad Name', '@scope:x:y'])('rejects key %p', (key) => {
    expect(pluginFromConfigKey(key)).toBeUndefined()
  })
})

describe('defaultSignalSwitchName', () => {
  it.each([['cloud-offline', 'Cloud Offline'], ['auth_failed', 'Auth Failed'], ['a.b', 'A B'], ['x', 'X'], ['---', '---']])('names %p %p', (signal, name) => {
    expect(defaultSignalSwitchName(signal)).toBe(name)
  })
})

describe('validateCatalogEntry', () => {
  it('keeps a valid entry and drops this plugin, bad names and bad text', () => {
    expect(validateCatalogEntry({ plugin: 'homebridge-example', signal: 'door', summary: 'Door open' }))
      .toEqual({ plugin: 'homebridge-example', signal: 'door', summary: 'Door open' })
    expect(validateCatalogEntry({ plugin: 'homebridge-pagerduty', signal: 'door', summary: 'x' })).toBeUndefined()
    expect(validateCatalogEntry({ plugin: 'homebridge-example', signal: 'a/b', summary: 'x' })).toBeUndefined()
    expect(validateCatalogEntry({ plugin: 'homebridge-example', signal: 'door', summary: '' })).toBeUndefined()
  })
})

describe('docs/SIGNALS.md', () => {
  it('publishes the schema text verbatim', () => {
    const doc = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'SIGNALS.md'), 'utf8')
    const block = /```sql\n([\s\S]*?)\n```/.exec(doc)

    expect(block?.[1]).toBe(SIGNAL_SCHEMA_SQL)
  })
})
