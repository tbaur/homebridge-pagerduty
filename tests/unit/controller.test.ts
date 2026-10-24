/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The controller end to end: switch writes in, events out, against a stand-in
 * Events API, a real state file and Jest's clock. Each test is one behavior a
 * user would describe ("I turned it off during the outage and nobody was
 * paged"), not one function.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AlertController, type ControllerOptions, type SignalReaderLike } from '../../src/controller'
import type { PollResult } from '../../src/signals/reader'
import type { PersistedState } from '../../src/state/model'
import { StateStore } from '../../src/state/store'
import type { ResolvedConfig, SignalRow } from '../../src/types'
import { alert, leveledAlert, resolvedConfig } from '../helpers/config'
import { fakeLogger, type RecordingLogger } from '../helpers/hap'
import { OTHER_ROUTING_KEY } from '../helpers/secrets'
import { ManualSleeps } from '../helpers/sleeps'
import { FakeEventsApi, status } from '../helpers/transport'

const MINUTE = 60_000
const STATE_FILE = 'state.json'

let dir: string
let running: AlertController[]

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate'], now: new Date('2026-01-01T00:00:00Z') })
  dir = mkdtempSync(join(tmpdir(), 'pd-controller-'))
  running = []
})

afterEach(async () => {
  for (const controller of running) {
    await controller.stop()
  }
  jest.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** Let every promise chain and pending file write run. */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

interface Harness {
  controller: AlertController
  api: FakeEventsApi
  log: RecordingLogger
  sleeps: ManualSleeps
  store: StateStore
}

function start(config: ResolvedConfig = resolvedConfig(), overrides: Partial<ControllerOptions> & { api?: FakeEventsApi } = {}): Harness {
  const api = overrides.api ?? new FakeEventsApi()
  const log = fakeLogger()
  const sleeps = new ManualSleeps()
  const store = new StateStore({ path: join(dir, STATE_FILE), log, persistDelivery: !config.options.dryRun })
  const controller = new AlertController({
    config,
    log,
    storageDir: dir,
    pluginVersion: '1.0.0',
    post: api.post,
    random: () => 0.5,
    sleep: sleeps.sleep,
    store,
    ...overrides,
  })
  controller.start()
  running.push(controller)
  return { controller, api, log, sleeps, store }
}

async function restart(previous: Harness, config: ResolvedConfig, api = previous.api): Promise<Harness> {
  await previous.controller.stop()
  running = running.filter((entry) => entry !== previous.controller)
  return start(config, { api })
}

/** The state file once every queued write has landed. */
async function stateOnDisk(h: Harness): Promise<PersistedState> {
  await h.store.flush()
  return JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')) as PersistedState
}

describe('switches', () => {
  it('pages on, resolves off, and records what PagerDuty accepted', async () => {
    const h = start()

    h.controller.setLevel('leak', 'critical', true)
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical'])
    expect(h.api.urls).toEqual(['https://events.pagerduty.com/v2/enqueue'])
    expect(h.controller.isLevelOn('leak', 'critical')).toBe(true)
    expect((await stateOnDisk(h)).delivered['alert:leak']).toEqual(expect.objectContaining({ dedupKey: 'homebridge/leak', severity: 'critical' }))

    h.controller.setLevel('leak', 'critical', false)
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical', 'resolve homebridge/leak'])
    expect((await stateOnDisk(h)).delivered).toEqual({})
    expect(h.log.lines('info')).toEqual(expect.arrayContaining(['Zone One Leak: switched on', 'Zone One Leak: switched off']))
  })

  it('raises severity but never lowers it, and resolves when the last level goes off', async () => {
    const h = start(resolvedConfig({ alerts: [leveledAlert('freezer', ['warning', 'critical'])] }))

    h.controller.setLevel('freezer', 'warning', true)
    await flush()
    h.controller.setLevel('freezer', 'critical', true)
    await flush()
    h.controller.setLevel('freezer', 'critical', false)
    await flush()
    h.controller.setLevel('freezer', 'warning', false)
    await flush()

    expect(h.api.actions).toEqual([
      'trigger homebridge/freezer warning',
      'trigger homebridge/freezer critical',
      'resolve homebridge/freezer',
    ])
  })

  it('ignores writes for unknown alerts and repeated writes that change nothing', async () => {
    const h = start()

    h.controller.setLevel('nope', 'critical', true)
    h.controller.setLevel('leak', 'critical', false)
    await flush()

    expect(h.api.bodies).toEqual([])
  })

  it('sends to the EU endpoint for an EU account', async () => {
    const h = start(resolvedConfig({ region: 'eu' }))

    h.controller.setLevel('leak', 'critical', true)
    await flush()

    expect(h.api.urls).toEqual(['https://events.eu.pagerduty.com/v2/enqueue'])
  })

  it('turns an alert off when its resolve timer runs out', async () => {
    const h = start(resolvedConfig({ alerts: [alert({ resolveAfterMinutes: 1 })] }))
    h.controller.setLevel('leak', 'critical', true)
    await flush()

    jest.advanceTimersByTime(MINUTE)
    await flush()

    expect(h.controller.isLevelOn('leak', 'critical')).toBe(false)
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical', 'resolve homebridge/leak'])
    expect(h.log.lines('info')).toContain('Zone One Leak: resolve timer expired; switched off')
  })

  it('tells listeners about changes, and survives one that throws', async () => {
    const h = start()
    const seen: number[] = []
    h.controller.onChange(() => {
      throw new Error('listener broke')
    })
    h.controller.onChange(() => seen.push(1))

    h.controller.setLevel('leak', 'critical', true)
    await flush()

    expect(seen.length).toBeGreaterThan(0)
    expect(h.log.lines('debug')).toContain('change listener failed: listener broke')
  })

  it('refuses to be used before start', () => {
    const controller = new AlertController({ config: resolvedConfig(), log: fakeLogger(), storageDir: dir, pluginVersion: '1' })

    expect(() => controller.isLevelOn('leak', 'critical')).toThrow('controller used before start()')
  })

  it('stops sending after stop', async () => {
    const h = start()
    await h.controller.stop()

    h.controller.setLevel('leak', 'critical', true)
    h.controller.setMaintenance(true)
    await flush()

    expect(h.api.bodies).toEqual([])
  })
})

describe('maintenance', () => {
  it('holds a page until maintenance ends, then sends it', async () => {
    const h = start()
    h.controller.setMaintenance(true)
    h.controller.setLevel('leak', 'critical', true)
    await flush()
    expect(h.api.bodies).toEqual([])
    expect(h.controller.gauges().heldByMaintenance).toBe(1)
    expect(h.controller.isDeliveryFault()).toBe(false)

    h.controller.setMaintenance(false)
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/leak critical'])
    expect(h.log.lines('info')).toEqual(expect.arrayContaining([
      'maintenance on: new pages are held for up to 240 min; resolves still go out',
      'maintenance off: sending anything still active',
    ]))
  })

  it('never holds a resolve, and lets a bypassing alert through', async () => {
    const config = resolvedConfig({ alerts: [alert(), alert({ id: 'smoke', bypassMaintenance: true })] })
    const h = start(config)
    h.controller.setLevel('leak', 'critical', true)
    await flush()

    h.controller.setMaintenance(true)
    h.controller.setLevel('leak', 'critical', false)
    h.controller.setLevel('smoke', 'critical', true)
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/leak critical', 'resolve homebridge/leak', 'trigger homebridge/smoke critical'])
  })

  it('turns itself off after maxMinutes and sends what was held', async () => {
    const h = start(resolvedConfig({ maintenance: { switch: true, name: 'PagerDuty Maintenance', maxMinutes: 15 } }))
    h.controller.setMaintenance(true)
    h.controller.setMaintenance(true)
    h.controller.setLevel('leak', 'critical', true)

    jest.advanceTimersByTime(15 * MINUTE)
    await flush()

    expect(h.controller.isMaintenanceOn()).toBe(false)
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical'])
    expect(h.log.lines('warn')).toContain('maintenance turned itself off after 15 min; paging is back on')
  })

  it('is ignored when the switch is not configured, and ended at start if it was left on', async () => {
    const first = start()
    first.controller.setMaintenance(true)

    const second = await restart(first, resolvedConfig({ maintenance: { switch: false, name: 'PagerDuty Maintenance', maxMinutes: 240 } }))
    second.controller.setMaintenance(true)

    expect(second.controller.isMaintenanceOn()).toBe(false)
    expect(second.log.lines('info')).toContain('maintenance ended: maintenance.switch is off in config')
  })
})

describe('outages', () => {
  it('retries, opens the delivery sensor after two minutes, and recovers', async () => {
    const api = new FakeEventsApi().queue(status(503))
    const h = start(resolvedConfig(), { api })
    h.controller.setLevel('leak', 'critical', true)
    await flush()
    expect(h.controller.gauges().outage).toBe(true)

    jest.advanceTimersByTime(2 * MINUTE)
    expect(h.controller.isDeliveryFault()).toBe(true)

    h.sleeps.releaseNext()
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical', 'trigger homebridge/leak critical'])
    expect(h.controller.isDeliveryFault()).toBe(false)
    expect(h.log.lines('info')).toContain('PagerDuty recovered after 2 min')
  })

  it('sends nothing for an alert that opened and closed while unreachable, and says so', async () => {
    const api = new FakeEventsApi().queue(status(503))
    const h = start(resolvedConfig({ alerts: [alert(), alert({ id: 'smoke' })] }), { api })
    h.controller.setLevel('leak', 'critical', true)
    await flush()
    h.controller.setLevel('leak', 'critical', false)
    h.sleeps.releaseNext()
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/leak critical'])

    h.controller.setLevel('smoke', 'critical', true)
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/leak critical', 'trigger homebridge/smoke critical'])
    expect(h.log.lines('info')).toContain('PagerDuty recovered after 1 min; 1 alert(s) opened and closed while unreachable, not sent')
  })

  it('aborts a request in flight on stop', async () => {
    let seenSignal: AbortSignal | undefined
    const h = start(resolvedConfig(), {
      post: (_url, _body, options) => {
        seenSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
    })
    h.controller.setLevel('leak', 'critical', true)
    await flush()

    await h.controller.stop()

    expect(seenSignal?.aborted).toBe(true)
  })
})

describe('rejections', () => {
  it('records a 4xx, opens the sensor, does not retry, and forgets it once the alert closes', async () => {
    const api = new FakeEventsApi().queue(status(400, '{"message":"Event object is invalid"}'))
    const h = start(resolvedConfig(), { api })

    h.controller.setLevel('leak', 'critical', true)
    await flush()
    expect(h.controller.isDeliveryFault()).toBe(true)
    expect(h.controller.gauges().rejected).toBe(1)
    expect(h.log.lines('warn')).toContain(
      'Zone One Leak: PagerDuty rejected the trigger: HTTP 400: Event object is invalid. Not retried until the alert changes',
    )

    jest.advanceTimersByTime(10 * MINUTE)
    await flush()
    expect(h.api.bodies).toHaveLength(1)

    h.controller.setLevel('leak', 'critical', false)
    await flush()
    expect(h.controller.isDeliveryFault()).toBe(false)
    expect((await stateOnDisk(h)).rejected).toEqual({})
  })
})

describe('restarts', () => {
  it('does not page twice for something already delivered', async () => {
    const first = start()
    first.controller.setLevel('leak', 'critical', true)
    await flush()

    const second = await restart(first, resolvedConfig())
    await flush()

    expect(second.api.actions).toEqual(['trigger homebridge/leak critical'])
    expect(second.controller.isLevelOn('leak', 'critical')).toBe(true)
  })

  it('resolves an alert that was removed from config, and forgets its switch', async () => {
    const config = resolvedConfig({ alerts: [alert(), alert({ id: 'smoke' })] })
    const first = start(config)
    first.controller.setLevel('smoke', 'critical', true)
    await flush()

    const second = await restart(first, resolvedConfig())
    await flush()

    expect(second.api.actions).toEqual(['trigger homebridge/smoke critical', 'resolve homebridge/smoke'])
    expect(Object.keys((await stateOnDisk(second)).levels)).toEqual([])
  })

  it('leaves a held alert exactly as it was', async () => {
    const first = start()
    first.controller.setLevel('leak', 'critical', true)
    await flush()

    const second = await restart(first, resolvedConfig({ alerts: [], heldAlertIds: ['leak'] }))
    await flush()

    expect(second.api.actions).toEqual(['trigger homebridge/leak critical'])
    expect(second.controller.isLevelOn('leak', 'critical')).toBe(true)
  })

  it('resolves every closed alert after a corrupt state file', async () => {
    writeFileSync(join(dir, STATE_FILE), '{ torn')
    const h = start()
    await flush()

    expect(h.api.actions).toEqual(['resolve homebridge/leak'])
    expect(h.log.lines('warn')).toContain('sending resolve for 1 alert(s) the lost state file may have left open')
  })

  it('warns about a changed key, then sends what is active on the new one', async () => {
    const first = start()
    first.controller.setLevel('leak', 'critical', true)
    await flush()

    const second = await restart(first, resolvedConfig({ routingKey: OTHER_ROUTING_KEY }))
    await flush()

    expect(second.api.actions).toEqual(['trigger homebridge/leak critical', 'trigger homebridge/leak critical'])
    expect(second.api.bodies[1]!.routing_key).toBe(OTHER_ROUTING_KEY)
    expect(second.log.lines('warn')[0]).toContain('the integration key changed while 1 alert(s) were open: Zone One Leak.')
  })

  it('keeps its files in the plugin directory, and throws when the state file there cannot be read', () => {
    const controller = new AlertController({ config: resolvedConfig(), log: fakeLogger(), storageDir: dir, pluginVersion: '1' })
    mkdirSync(join(dir, 'homebridge-pagerduty', STATE_FILE), { recursive: true })

    expect(() => controller.start()).toThrow('state file could not be read')
  })
})

describe('dry run', () => {
  it('logs what it would send, sends nothing, and keeps delivery out of the state file', async () => {
    const h = start(resolvedConfig({ options: { ...resolvedConfig().options, dryRun: true } }))

    h.controller.setLevel('leak', 'critical', true)
    await flush()
    h.controller.setLevel('leak', 'critical', false)
    await flush()
    await h.controller.stop()

    expect(h.api.bodies).toEqual([])
    expect(h.log.lines('info')).toEqual(expect.arrayContaining([
      'dry run: would send trigger (critical) for Zone One Leak as homebridge/leak',
      'dry run: would send resolve for Zone One Leak as homebridge/leak',
    ]))
    expect((await stateOnDisk(h)).delivered).toEqual({})
  })
})

describe('the signal store', () => {
  const SOURCES = ['homebridge-example']

  function row(overrides: Partial<SignalRow> = {}): SignalRow {
    return { plugin: 'homebridge-example', signal: 'door', active: true, severity: 'warning', summary: 'Door open', updatedAt: 1, ...overrides }
  }

  function rows(list: SignalRow[], extra: Partial<Extract<PollResult, { kind: 'rows' }>> = {}): PollResult {
    return { kind: 'rows', rows: list, complete: true, foreignWriters: [], invalidRows: 0, ...extra }
  }

  /** A reader that answers each poll from a script, then repeats the last answer as `unchanged`. */
  function scriptedReader(script: PollResult[], created: string[] = []): ControllerOptions['createReader'] {
    return (path, sources) => {
      created.push(`${path} ${sources.join(',')}`)
      const reader: SignalReaderLike = {
        create: () => undefined,
        poll: () => script.shift() ?? { kind: 'unchanged' },
        close: () => undefined,
      }
      return reader
    }
  }

  it('pages for an unbound allowlisted row and resolves when it clears', async () => {
    const created: string[] = []
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: scriptedReader([rows([row()]), rows([row({ active: false })])], created),
    })
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning'])
    expect(created).toEqual([`${join(dir, 'homebridge-pagerduty', 'signals.sqlite')} homebridge-example`])

    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning', 'resolve homebridge/homebridge-example/door'])
    expect(h.controller.gauges().storeOk).toBe(true)
  })

  it('drives a bound alert, which pages at the row severity under the configured summary', async () => {
    const bound = alert({ id: 'door', levels: [{ severity: 'error', name: 'Door' }], signal: { plugin: 'homebridge-example', signal: 'door' } })
    const h = start(resolvedConfig({ alerts: [bound], signalSources: SOURCES }), {
      createReader: scriptedReader([rows([row({ severity: 'critical' })])]),
    })
    await flush()

    expect(h.controller.isLevelOn('door', 'error')).toBe(true)
    expect(h.api.actions).toEqual(['trigger homebridge/door critical'])
    const body = h.api.bodies[0]!
    expect(body.event_action === 'trigger' && body.payload).toEqual(expect.objectContaining({
      summary: bound.summary,
      custom_details: { origin: 'signal', level: 'Door', detail: 'Door open' },
    }))
  })

  it('logs other writers once, invalid rows quietly, and an over-full store loudly', async () => {
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: scriptedReader([
        rows([], { foreignWriters: ['homebridge-other'], invalidRows: 2, complete: false }),
        rows([], { foreignWriters: ['homebridge-other'] }),
      ]),
    })
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.log.lines('info').filter((line) => line.includes('homebridge-other'))).toEqual([
      'signal store: homebridge-other writes signals but is not in signals.sources; ignored',
    ])
    expect(h.log.lines('debug')).toContain('signal store: 2 row(s) failed validation and were ignored')
    expect(h.log.lines('warn')).toContain('signal store holds more rows than are read; rows that have gone are not cleared until it shrinks')
  })

  it('keeps the last rows while the store is unreadable, opens the sensor after five minutes, and recovers', async () => {
    const unavailable: PollResult = { kind: 'unavailable', reason: 'file is not a database' }
    const script: PollResult[] = [rows([row()]), ...Array.from({ length: 151 }, () => unavailable), { kind: 'unchanged' }]
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), { createReader: scriptedReader(script) })
    await flush()

    jest.advanceTimersByTime(2_000)
    expect(h.log.lines('warn')).toEqual(['signal store unavailable (file is not a database); keeping the last rows read'])
    expect(h.controller.gauges().storeOk).toBe(false)

    jest.advanceTimersByTime(5 * MINUTE)
    expect(h.controller.isDeliveryFault()).toBe(true)
    expect(h.log.lines('warn')).toHaveLength(1)

    jest.advanceTimersByTime(2_000)
    expect(h.controller.isDeliveryFault()).toBe(false)
    expect(h.log.lines('info')).toContain('signal store readable again')
    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning'])
  })

  it('logs a busy store at debug only', async () => {
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: scriptedReader([{ kind: 'unavailable', reason: 'busy' }, rows([])]),
    })
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.log.lines('warn')).toEqual([])
    expect(h.log.lines('debug')).toContain('signal store unavailable (busy); keeping the last rows read')
    expect(h.log.lines('info')).not.toContain('signal store readable again')
  })

  it('treats a store that cannot be created as unavailable', async () => {
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: () => ({
        create: () => {
          throw new Error('permission denied')
        },
        poll: () => ({ kind: 'unavailable', reason: 'missing' }),
        close: () => undefined,
      }),
    })
    await flush()

    expect(h.log.lines('warn')[0]).toBe('signal store unavailable (permission denied); keeping the last rows read')
  })

  it('after a corrupt state file, resolves rows that the first read shows closed', async () => {
    writeFileSync(join(dir, STATE_FILE), 'garbage')
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: scriptedReader([rows([row({ active: false })])]),
    })
    await flush()

    expect(h.api.actions).toEqual(['resolve homebridge/homebridge-example/door'])
  })

  it('persists a summary-only change without sending anything', async () => {
    const h = start(resolvedConfig({ alerts: [], signalSources: SOURCES }), {
      createReader: scriptedReader([rows([row()]), rows([row({ summary: 'Still open', updatedAt: 2 })])]),
    })
    await flush()
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.api.bodies).toHaveLength(1)
    expect((await stateOnDisk(h)).rowsSeen['homebridge-example/door']!.summary).toBe('Still open')
  })
})
