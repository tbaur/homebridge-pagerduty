/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Accessory context comes back from disk as untrusted input, and the identity
 * key decides the UUID: get either wrong and a user loses rooms and scenes.
 */

import type { PlatformAccessory } from 'homebridge'

import {
  accessoryIdentityKey,
  bindAccessoryContext,
  parseAccessoryContext,
} from '../../../src/utils/context'
import { FakeAccessory } from '../../helpers/hap'

describe('parseAccessoryContext', () => {
  it('reads an alert context', () => {
    expect(parseAccessoryContext({ kind: 'alert', alertId: 'leak', severity: 'critical', serialNumber: 'SERIAL-0001' }))
      .toEqual({ kind: 'alert', alertId: 'leak', severity: 'critical', serialNumber: 'SERIAL-0001' })
  })

  it('reads a maintenance or delivery context', () => {
    expect(parseAccessoryContext({ kind: 'maintenance', serialNumber: 'SERIAL-0002' }))
      .toEqual({ kind: 'maintenance', serialNumber: 'SERIAL-0002' })
  })

  it('regenerates a missing serial number rather than dropping the accessory', () => {
    const parsed = parseAccessoryContext({ kind: 'delivery' })

    expect(parsed?.serialNumber).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each([
    ['nothing', undefined],
    ['a string', 'alert'],
    ['an unknown kind', { kind: 'thermostat' }],
    ['an alert without an id', { kind: 'alert', severity: 'critical' }],
    ['an alert with a bad severity', { kind: 'alert', alertId: 'leak', severity: 'urgent' }],
  ])('rejects %s', (_name, value) => {
    expect(parseAccessoryContext(value)).toBeUndefined()
  })
})

describe('bindAccessoryContext', () => {
  it('writes identity and keeps an existing serial number', () => {
    const accessory = new FakeAccessory('Leak', 'uuid:x', { kind: 'alert', alertId: 'leak', severity: 'critical', serialNumber: 'SERIAL-0001' })

    const context = bindAccessoryContext(accessory as unknown as PlatformAccessory, {
      kind: 'alert', name: 'Leak', alertId: 'leak', severity: 'critical',
    })

    expect(context).toEqual({ kind: 'alert', alertId: 'leak', severity: 'critical', serialNumber: 'SERIAL-0001' })
    expect(accessory.context).toEqual(context)
  })

  it('generates a serial number for a new accessory', () => {
    const accessory = new FakeAccessory('Maintenance')

    const context = bindAccessoryContext(accessory as unknown as PlatformAccessory, { kind: 'maintenance', name: 'Maintenance' })

    expect(context.serialNumber).toMatch(/^[0-9a-f-]{36}$/)
    expect(context).not.toHaveProperty('alertId')
  })
})

describe('accessoryIdentityKey', () => {
  it('uses alert id and severity, never the name', () => {
    expect(accessoryIdentityKey({ kind: 'alert', alertId: 'leak', severity: 'critical' })).toBe('alert:leak:critical')
    expect(accessoryIdentityKey({ kind: 'alert' })).toBe('alert::')
    expect(accessoryIdentityKey({ kind: 'maintenance' })).toBe('maintenance')
    expect(accessoryIdentityKey({ kind: 'delivery' })).toBe('delivery')
  })
})
