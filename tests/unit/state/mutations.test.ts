/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Every change to persisted state, called directly with an explicit time.
 */

import { emptyState } from '../../../src/state/model'
import {
  applyKeyChange,
  applyLevelWrite,
  applyMaintenance,
  applyRows,
  expireResolveTimers,
  isAnyLevelOn,
  nextDeadline,
  pruneRows,
} from '../../../src/state/mutations'
import type { ResolvedAlert, SignalRow } from '../../../src/types'
import { alert, leveledAlert } from '../../helpers/config'

const MINUTE = 60_000

describe('applyLevelWrite', () => {
  it('turns a level on and off, recording when', () => {
    const state = emptyState()

    expect(applyLevelWrite(state, alert(), { severity: 'critical', on: true, at: 10 })).toBe(true)
    expect(state.levels['leak:critical']).toEqual({ on: true, changedAt: 10 })
    expect(applyLevelWrite(state, alert(), { severity: 'critical', on: false, at: 20 })).toBe(true)
    expect(state.levels['leak:critical']).toEqual({ on: false, changedAt: 20 })
  })

  it('changes nothing for a repeated On without a timer', () => {
    const state = emptyState()
    applyLevelWrite(state, alert(), { severity: 'critical', on: true, at: 10 })

    expect(applyLevelWrite(state, alert(), { severity: 'critical', on: true, at: 20 })).toBe(false)
    expect(state.levels['leak:critical']!.changedAt).toBe(10)
  })

  it('restarts the resolve timer on a repeated On', () => {
    const timed = alert({ resolveAfterMinutes: 30 })
    const state = emptyState()
    applyLevelWrite(state, timed, { severity: 'critical', on: true, at: 0 })

    expect(applyLevelWrite(state, timed, { severity: 'critical', on: true, at: 10 * MINUTE })).toBe(true)
    expect(state.alerts.leak!.resolveAt).toBe(40 * MINUTE)
  })

  it('cancels the timer when the last level goes off, not before', () => {
    const timed: ResolvedAlert = { ...leveledAlert('freezer', ['warning', 'critical']), resolveAfterMinutes: 30 }
    const state = emptyState()
    applyLevelWrite(state, timed, { severity: 'warning', on: true, at: 0 })
    applyLevelWrite(state, timed, { severity: 'critical', on: true, at: 0 })

    applyLevelWrite(state, timed, { severity: 'warning', on: false, at: 1 })
    expect(state.alerts.freezer!.resolveAt).toBe(30 * MINUTE)
    expect(isAnyLevelOn(state, timed)).toBe(true)

    applyLevelWrite(state, timed, { severity: 'critical', on: false, at: 2 })
    expect(state.alerts.freezer!.resolveAt).toBeNull()
  })
})

describe('expireResolveTimers', () => {
  it('turns every level off once the deadline has passed, including one missed while down', () => {
    const timed: ResolvedAlert = { ...leveledAlert('freezer', ['warning', 'critical']), resolveAfterMinutes: 5 }
    const state = emptyState()
    applyLevelWrite(state, timed, { severity: 'warning', on: true, at: 0 })
    applyLevelWrite(state, timed, { severity: 'critical', on: true, at: 0 })

    expect(expireResolveTimers(state, [timed], 5 * MINUTE - 1)).toEqual([])
    expect(expireResolveTimers(state, [timed], 60 * MINUTE)).toEqual([timed])
    expect(isAnyLevelOn(state, timed)).toBe(false)
    expect(state.alerts.freezer!.resolveAt).toBeNull()
  })
})

describe('applyMaintenance', () => {
  it('opens a window that ends after maxMinutes', () => {
    const state = emptyState()

    expect(applyMaintenance(state, { on: true, at: 0, maxMinutes: 15 })).toBe(true)
    expect(state.maintenance).toEqual({ on: true, since: 0, until: 15 * MINUTE })
  })

  it('does not extend the window on a repeated On', () => {
    const state = emptyState()
    applyMaintenance(state, { on: true, at: 0, maxMinutes: 15 })

    expect(applyMaintenance(state, { on: true, at: 10 * MINUTE, maxMinutes: 15 })).toBe(false)
    expect(state.maintenance.until).toBe(15 * MINUTE)
  })

  it('clears the window when turned off', () => {
    const state = emptyState()
    applyMaintenance(state, { on: true, at: 0, maxMinutes: 15 })
    applyMaintenance(state, { on: false, at: 1, maxMinutes: 15 })

    expect(state.maintenance).toEqual({ on: false, since: null, until: null })
  })
})

describe('nextDeadline', () => {
  it('is the soonest of the resolve timers and the maintenance end', () => {
    const state = emptyState()
    expect(nextDeadline(state, [alert()])).toBeUndefined()

    state.alerts.leak = { resolveAt: 500 }
    state.maintenance = { on: true, since: 0, until: 300 }

    expect(nextDeadline(state, [alert()])).toBe(300)
  })
})

describe('applyRows', () => {
  const SOURCES = ['homebridge-example']

  function row(overrides: Partial<SignalRow> = {}): SignalRow {
    return {
      plugin: 'homebridge-example',
      signal: 'door',
      active: true,
      severity: 'warning',
      summary: 'Door open',
      updatedAt: 100,
      ...overrides,
    }
  }

  it('records a new row as a change, timed by updated_at', () => {
    const state = emptyState()

    const result = applyRows(state, { rows: [row()], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 1_000 })

    expect(result).toEqual({ changed: ['homebridge-example/door'], dirty: true })
    expect(state.rowsSeen['homebridge-example/door']).toEqual({ active: true, severity: 'warning', summary: 'Door open', changedAt: 100 })
  })

  it('uses the clock instead of an updated_at from the future', () => {
    const state = emptyState()

    applyRows(state, { rows: [row({ updatedAt: 5_000 })], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 1_000 })

    expect(state.rowsSeen['homebridge-example/door']!.changedAt).toBe(1_000)
  })

  it('treats a summary-only change as dirty but not as a change', () => {
    const state = emptyState()
    applyRows(state, { rows: [row()], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 1_000 })

    const result = applyRows(state, { rows: [row({ summary: 'Still open', updatedAt: 200 })], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 2_000 })

    expect(result).toEqual({ changed: [], dirty: true })
    expect(state.rowsSeen['homebridge-example/door']!.summary).toBe('Still open')
  })

  it('treats an updated_at change alone as nothing', () => {
    const state = emptyState()
    applyRows(state, { rows: [row()], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 1_000 })

    expect(applyRows(state, { rows: [row({ updatedAt: 900 })], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 2_000 }))
      .toEqual({ changed: [], dirty: false })
  })

  it('clears a row that has gone, but only after a complete read', () => {
    const state = emptyState()
    applyRows(state, { rows: [row()], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 1_000 })

    expect(applyRows(state, { rows: [], complete: false, sources: SOURCES, boundAlerts: new Map(), now: 2_000 }).changed).toEqual([])
    expect(state.rowsSeen['homebridge-example/door']!.active).toBe(true)

    expect(applyRows(state, { rows: [], complete: true, sources: SOURCES, boundAlerts: new Map(), now: 3_000 }).changed)
      .toEqual(['homebridge-example/door'])
    expect(state.rowsSeen['homebridge-example/door']).toEqual(expect.objectContaining({ active: false, changedAt: 3_000 }))
  })

  it('drives the switch of a bound alert, in both directions', () => {
    const bound = alert({ id: 'door', levels: [{ severity: 'error', name: 'Door' }] })
    const boundAlerts = new Map([['homebridge-example/door', bound]])
    const state = emptyState()

    applyRows(state, { rows: [row()], complete: true, sources: SOURCES, boundAlerts, now: 1_000 })
    expect(state.levels['door:error']!.on).toBe(true)

    applyRows(state, { rows: [], complete: true, sources: SOURCES, boundAlerts, now: 2_000 })
    expect(state.levels['door:error']!.on).toBe(false)
  })
})

describe('pruneRows', () => {
  it('forgets rows from packages removed from the allowlist', () => {
    const state = emptyState()
    state.rowsSeen['homebridge-gone/door'] = { active: true, severity: 'info', summary: 'x', changedAt: 1 }
    state.rowsSeen['homebridge-example/door'] = { active: true, severity: 'info', summary: 'x', changedAt: 1 }

    expect(pruneRows(state, ['homebridge-example'])).toBe(true)
    expect(Object.keys(state.rowsSeen)).toEqual(['homebridge-example/door'])
    expect(pruneRows(state, ['homebridge-example'])).toBe(false)
  })
})

describe('applyKeyChange', () => {
  it('records the first fingerprint without orphaning anything', () => {
    const state = emptyState()

    expect(applyKeyChange(state, 'a')).toEqual([])
    expect(state.routingKeyFingerprint).toBe('a')
  })

  it('does nothing when the key is unchanged', () => {
    const state = emptyState()
    applyKeyChange(state, 'a')
    state.delivered['alert:leak'] = { dedupKey: 'x', severity: 'info', openedAt: 1 }

    expect(applyKeyChange(state, 'a')).toEqual([])
    expect(state.delivered['alert:leak']).toBeDefined()
  })

  it('clears delivered and rejected records on a new key and names what was orphaned', () => {
    const state = emptyState()
    applyKeyChange(state, 'a')
    state.delivered['alert:leak'] = { dedupKey: 'x', severity: 'info', openedAt: 1 }
    state.rejected['alert:leak'] = { desiredHash: 'h', at: 1, reason: 'r' }

    expect(applyKeyChange(state, 'b')).toEqual(['alert:leak'])
    expect(state.delivered).toEqual({})
    expect(state.rejected).toEqual({})
    expect(state.routingKeyFingerprint).toBe('b')
  })
})
