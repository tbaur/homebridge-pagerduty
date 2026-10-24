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
import { alert, leveledAlert, resolvedConfig } from '../../helpers/config'

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

  it('gives a bound alert the severity of the last row seen, and the row text as detail', () => {
    const bound = alert({ id: 'sump', levels: [{ severity: 'error', name: 'Sump' }], signal: { plugin: 'homebridge-example', signal: 'sump-high' } })
    const config = resolvedConfig({ alerts: [bound], signalSources: ['homebridge-example'] })
    const state = stateWith({
      levels: { 'sump:error': { on: true, changedAt: 7 } },
      rowsSeen: { 'homebridge-example/sump-high': { active: true, severity: 'critical', summary: 'Level 90%', changedAt: 7 } },
    })

    const desired = computeDesired(config, state)

    expect(desired.get('alert:sump')).toEqual(expect.objectContaining({ open: true, severity: 'critical', summary: bound.summary }))
    expect(desired.get('alert:sump')!.details.custom).toEqual({ origin: 'signal', level: 'Sump', detail: 'Level 90%' })
    // A bound row never becomes a target of its own.
    expect([...desired.keys()]).toEqual(['alert:sump'])
  })

  it('makes an unbound allowlisted row a target of its own', () => {
    const config = resolvedConfig({ alerts: [], signalSources: ['homebridge-example'] })
    const state = stateWith({
      rowsSeen: { 'homebridge-example/door': { active: true, severity: 'warning', summary: 'Door open', changedAt: 3 } },
    })

    const target = computeDesired(config, state).get('signal:homebridge-example/door')!

    expect(target).toEqual(expect.objectContaining({
      open: true, severity: 'warning', summary: 'Door open', dedupKey: 'homebridge/homebridge-example/door', bypassMaintenance: false,
    }))
    expect(target.details).toEqual({ component: 'door', group: 'homebridge-example', custom: { origin: 'signal' } })
  })

  it('ignores rows from packages that are not on the allowlist, and malformed keys', () => {
    const config = resolvedConfig({ alerts: [], signalSources: ['homebridge-example'] })
    const state = stateWith({
      rowsSeen: {
        'homebridge-other/door': { active: true, severity: 'warning', summary: 'x', changedAt: 1 },
        'noslash': { active: true, severity: 'warning', summary: 'x', changedAt: 1 },
      },
    })

    expect(computeDesired(config, state).size).toBe(0)
  })
})
