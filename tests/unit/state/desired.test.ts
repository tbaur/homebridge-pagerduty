/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Desired state is where switches, rows and config meet. These rules decide
 * what severity a page carries and which rows may page at all.
 */

import { computeDesired } from '../../../src/state/desired'
import { emptyState, type PersistedState } from '../../../src/state/model'
import { allowedPlugin, leveledAlert, resolvedConfig, signal } from '../../helpers/config'

function stateWith(patch: Partial<PersistedState>): PersistedState {
  return { ...emptyState(), ...patch }
}

describe('computeDesired', () => {
  it('has a closed target for every configured alert', () => {
    const desired = computeDesired(resolvedConfig(), emptyState())

    expect(desired.get('alert:leak')).toEqual(expect.objectContaining({
      open: false, dedupKey: 'homebridge/leak', severity: 'critical', held: false,
    }))
  })

  it('opens an alert while any level is on, at the highest level that is on', () => {
    const config = resolvedConfig({ alerts: [leveledAlert('freezer', ['warning', 'error', 'critical'])] })
    const state = stateWith({
      levels: {
        'freezer:warning': { on: true, changedAt: 10 },
        'freezer:error': { on: true, changedAt: 20 },
        'freezer:critical': { on: false, changedAt: 5 },
      },
    })

    const target = computeDesired(config, state).get('alert:freezer')!

    expect(target.open).toBe(true)
    expect(target.severity).toBe('error')
    expect(target.changedAt).toBe(20)
    expect(target.details.custom).toEqual({ origin: 'switch', level: 'Freezer error' })
  })

  it('uses the configured source in the dedup key', () => {
    const desired = computeDesired(resolvedConfig({ source: 'cabin' }), emptyState())

    expect(desired.get('alert:leak')!.dedupKey).toBe('cabin/leak')
  })

  it('marks held alerts so the reconciler leaves them alone', () => {
    const desired = computeDesired(resolvedConfig({ heldAlertIds: ['broken'] }), emptyState())

    expect(desired.get('alert:broken')!.held).toBe(true)
  })

  it('makes a row from an allowed plugin a target, using the plugin severity and text by default', () => {
    const config = resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example')] })
    const state = stateWith({
      rowsSeen: { 'homebridge-example/door': { active: true, severity: 'warning', summary: 'Door open', changedAt: 3 } },
    })

    const target = computeDesired(config, state).get('signal:homebridge-example/door')!

    expect(target).toEqual(expect.objectContaining({
      open: true, severity: 'warning', summary: 'Door open', dedupKey: 'homebridge/homebridge-example/door', bypassMaintenance: false, changedAt: 3,
    }))
    expect(target.details).toEqual({ component: 'door', group: 'homebridge-example', custom: { origin: 'signal' } })
  })

  it('applies the title, severity and maintenance overrides, keeping the plugin text as detail', () => {
    const settings = signal({ signal: 'door', summary: 'Zone Two door open', severity: 'critical', bypassMaintenance: true })
    const config = resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example', [settings])] })
    const state = stateWith({
      rowsSeen: { 'homebridge-example/door': { active: true, severity: 'warning', summary: 'Door open', changedAt: 3 } },
    })

    const target = computeDesired(config, state).get('signal:homebridge-example/door')!

    expect(target).toEqual(expect.objectContaining({ severity: 'critical', summary: 'Zone Two door open', bypassMaintenance: true }))
    expect(target.details.custom).toEqual({ origin: 'signal', detail: 'Door open' })
  })

  it('leaves out a muted signal, so anything it had open resolves', () => {
    const config = resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example', [signal({ signal: 'door', enabled: false })])] })
    const state = stateWith({
      rowsSeen: { 'homebridge-example/door': { active: true, severity: 'warning', summary: 'Door open', changedAt: 3 } },
    })

    expect(computeDesired(config, state).has('signal:homebridge-example/door')).toBe(false)
  })

  it('follows the switch of a signal that has one, including before any row exists', () => {
    const settings = signal({ signal: 'door', switch: true, switchName: 'Zone Two' })
    const config = resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example', [settings])] })

    expect(computeDesired(config, emptyState()).get('signal:homebridge-example/door')).toEqual(expect.objectContaining({
      open: false, severity: 'critical', summary: 'Zone Two',
    }))

    const state = stateWith({
      rowsSeen: { 'homebridge-example/door': { active: false, severity: 'warning', summary: 'Door shut', changedAt: 3 } },
      switches: { 'homebridge-example/door': { on: true, changedAt: 9 } },
    })
    const target = computeDesired(config, state).get('signal:homebridge-example/door')!

    expect(target).toEqual(expect.objectContaining({ open: true, severity: 'warning', summary: 'Door shut', changedAt: 9 }))
    expect(target.details.custom).toEqual({ origin: 'switch' })
  })

  it('ignores rows from plugins that are not allowed, and malformed keys', () => {
    const config = resolvedConfig({
      alerts: [],
      signalPlugins: [allowedPlugin('homebridge-example'), { plugin: 'homebridge-other', allow: false, signals: [] }],
    })
    const state = stateWith({
      rowsSeen: {
        'homebridge-other/door': { active: true, severity: 'warning', summary: 'x', changedAt: 1 },
        'noslash': { active: true, severity: 'warning', summary: 'x', changedAt: 1 },
      },
    })

    expect(computeDesired(config, state).size).toBe(0)
  })
})
