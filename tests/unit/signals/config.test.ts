/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * These lookups decide whether a plugin may page at all, so a plugin the user
 * has not allowed must never get settings back.
 */

import { allowedPlugins, requestedSignalSwitches, signalSettings, signalSwitches } from '../../../src/signals/config'
import { allowedPlugin, signal } from '../../helpers/config'

const config = {
  signalPlugins: [
    allowedPlugin('homebridge-example', [signal({ signal: 'door', summary: 'Zone Two door open', switch: true })]),
    { plugin: 'homebridge-off', allow: false, signals: [signal({ plugin: 'homebridge-off', signal: 'x', switch: true })] },
  ],
}

describe('signal lookups', () => {
  it('lists only allowed plugins', () => {
    expect(allowedPlugins(config)).toEqual(['homebridge-example'])
  })

  it('returns saved settings, defaults for a new signal, and nothing for a plugin that is not allowed', () => {
    expect(signalSettings(config, { plugin: 'homebridge-example', signal: 'door' })?.summary).toBe('Zone Two door open')
    expect(signalSettings(config, { plugin: 'homebridge-example', signal: 'cloud-offline' })).toEqual({
      plugin: 'homebridge-example',
      signal: 'cloud-offline',
      enabled: true,
      bypassMaintenance: false,
      switch: false,
      switchName: 'Cloud Offline',
    })
    expect(signalSettings(config, { plugin: 'homebridge-off', signal: 'x' })).toBeUndefined()
    expect(signalSettings(config, { plugin: 'homebridge-unknown', signal: 'x' })).toBeUndefined()
  })

  it('gives switches only to allowed plugins, up to the cap', () => {
    const many = { signalPlugins: [allowedPlugin('homebridge-example', Array.from({ length: 25 }, (_unused, index) => signal({ signal: `s${index}`, switch: true })))] }

    expect(signalSwitches(config).map((entry) => entry.signal)).toEqual(['door'])
    expect(requestedSignalSwitches(many)).toHaveLength(25)
    expect(signalSwitches(many)).toHaveLength(20)
  })
})
