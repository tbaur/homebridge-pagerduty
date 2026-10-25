/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The state file records what PagerDuty has accepted. Losing it is survivable
 * (the resolve sweep), but reading it wrong is not: a record dropped silently
 * leaves an incident open with nothing left that knows about it.
 */

import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyState, type PersistedState } from '../../../src/state/model'
import { fingerprintRoutingKey, parseState, StateStore } from '../../../src/state/store'
import { StateUnreadableError } from '../../../src/utils/errors'
import { fakeLogger } from '../../helpers/hap'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-store-'))
  path = join(dir, 'state.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function populated(): PersistedState {
  const state = emptyState()
  state.routingKeyFingerprint = 'fp'
  state.levels['leak:critical'] = { on: true, changedAt: 1 }
  state.alerts.leak = { resolveAt: null }
  state.rowsSeen['homebridge-example/door'] = { active: true, severity: 'warning', summary: 'Door open', changedAt: 2 }
  state.switches['homebridge-example/door'] = { on: false, changedAt: 3 }
  state.delivered['alert:leak'] = { dedupKey: 'homebridge/leak', severity: 'critical', openedAt: 3 }
  state.rejected['alert:other'] = { desiredHash: 'h', at: 4, reason: 'HTTP 400' }
  return state
}

describe('StateStore', () => {
  it('starts empty on first run', () => {
    const store = new StateStore({ path, log: fakeLogger(), persistDelivery: true })

    expect(store.load()).toEqual({ state: emptyState(), outcome: 'fresh' })
  })

  it('round-trips a state through the file, owner-only', async () => {
    const store = new StateStore({ path, log: fakeLogger(), persistDelivery: true })
    await store.save(populated())

    expect(new StateStore({ path, log: fakeLogger(), persistDelivery: true }).load())
      .toEqual({ state: populated(), outcome: 'loaded' })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('moves a corrupt file aside and starts empty', () => {
    writeFileSync(path, '{"version":1,')
    const log = fakeLogger()

    const loaded = new StateStore({ path, log, persistDelivery: true, now: () => 77 }).load()

    expect(loaded.outcome).toBe('corrupt')
    expect(loaded.state).toEqual(emptyState())
    expect(existsSync(`${path}.corrupt-77`)).toBe(true)
    expect(log.lines('warn')[0]).toContain('moved aside')
  })

  it('still starts empty when a corrupt file cannot be moved aside', () => {
    writeFileSync(path, 'not json')
    chmodSync(dir, 0o500)
    const log = fakeLogger()

    try {
      const loaded = new StateStore({ path, log, persistDelivery: true }).load()
      expect(loaded.outcome).toBe('corrupt')
      expect(log.lines('warn')[0]).toContain('could not be moved aside')
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('throws on a file it cannot read, rather than starting empty', () => {
    // A directory where the file should be reads as EISDIR on every platform.
    const store = new StateStore({ path: dir, log: fakeLogger(), persistDelivery: true })

    expect(() => store.load()).toThrow(StateUnreadableError)
  })

  it('creates its directory owner-only on first run', () => {
    const nested = join(dir, 'homebridge-pagerduty', 'state.json')

    expect(new StateStore({ path: nested, log: fakeLogger(), persistDelivery: true }).load().outcome).toBe('fresh')
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'homebridge-pagerduty')).mode & 0o777).toBe(0o700)
    }
  })

  it('throws when its directory cannot be created', () => {
    writeFileSync(join(dir, 'homebridge-pagerduty'), 'in the way')
    const store = new StateStore({ path: join(dir, 'homebridge-pagerduty', 'state.json'), log: fakeLogger(), persistDelivery: true })

    expect(() => store.load()).toThrow('state directory could not be created')
  })

  it('in a dry run, writes switch state but keeps the delivery records it loaded', async () => {
    const real = new StateStore({ path, log: fakeLogger(), persistDelivery: true })
    await real.save(populated())

    const dry = new StateStore({ path, log: fakeLogger(), persistDelivery: false })
    const { state } = dry.load()
    state.levels['leak:critical'] = { on: false, changedAt: 9 }
    state.delivered = {}
    state.rejected = {}
    await dry.save(state)

    const written = JSON.parse(readFileSync(path, 'utf8')) as PersistedState
    expect(written.levels['leak:critical']).toEqual({ on: false, changedAt: 9 })
    expect(written.delivered).toEqual(populated().delivered)
    expect(written.rejected).toEqual(populated().rejected)
  })

  it('serializes writes so the last snapshot wins', async () => {
    const order: number[] = []
    const store = new StateStore({
      path,
      log: fakeLogger(),
      persistDelivery: true,
      write: async (_path, value) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push((value as PersistedState).levels.x?.changedAt ?? -1)
      },
    })
    const state = emptyState()
    state.levels.x = { on: true, changedAt: 1 }
    void store.save(state)
    state.levels.x = { on: true, changedAt: 2 }
    void store.save(state)
    await store.flush()

    expect(order).toEqual([1, 2])
  })

  it('logs a failed write and keeps going', async () => {
    const log = fakeLogger()
    const store = new StateStore({ path, log, persistDelivery: true, write: () => Promise.reject(new Error('disk full')) })

    await store.save(emptyState())

    expect(log.lines('error')).toEqual(['state file could not be written: disk full'])
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('parseState', () => {
  const valid = JSON.stringify(populated())

  it('accepts a well-formed state', () => {
    expect(parseState(valid)).toEqual(populated())
  })

  it.each<[string, (state: Record<string, unknown>) => void]>([
    ['another version', (state) => { state.version = 2 }],
    ['a non-string fingerprint', (state) => { state.routingKeyFingerprint = 5 }],
    ['a bad maintenance block', (state) => { state.maintenance = { on: 'yes', since: null, until: null } }],
    ['a bad level', (state) => { state.levels = { x: { on: true } } }],
    ['a bad timer', (state) => { state.alerts = { x: { resolveAt: 'soon' } } }],
    ['a bad row', (state) => { state.rowsSeen = { x: { active: true, severity: 'urgent', summary: 's', changedAt: 1 } } }],
    ['a bad signal switch', (state) => { state.switches = { x: { on: 'yes', changedAt: 1 } } }],
    ['a bad delivered record', (state) => { state.delivered = { x: { dedupKey: 1, severity: 'info', openedAt: 1 } } }],
    ['a bad rejected record', (state) => { state.rejected = { x: { desiredHash: 'h', at: 1 } } }],
    ['an array where a record belongs', (state) => { state.levels = [] }],
  ])('rejects the whole file for %s', (_name, damage) => {
    const state = JSON.parse(valid) as Record<string, unknown>
    damage(state)

    expect(parseState(JSON.stringify(state))).toBeUndefined()
  })

  it('reads a file written before signal switches existed', () => {
    const state = JSON.parse(valid) as Record<string, unknown>
    delete state.switches

    expect(parseState(JSON.stringify(state))).toEqual({ ...populated(), switches: {} })
  })

  it('rejects something that is not JSON or not an object', () => {
    expect(parseState('nope')).toBeUndefined()
    expect(parseState('[]')).toBeUndefined()
  })
})

describe('fingerprintRoutingKey', () => {
  it('is a SHA-256 hex digest that does not contain the key', () => {
    const fingerprint = fingerprintRoutingKey(FAKE_ROUTING_KEY)

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).not.toContain(FAKE_ROUTING_KEY)
  })
})
