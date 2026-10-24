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
import type { PollResult, SqliteModule } from '../../src/signals/reader'
import { SIGNAL_SCHEMA_SQL } from '../../src/signals/schema'
import type { PersistedState } from '../../src/state/model'
import { StateStore } from '../../src/state/store'
import type { CatalogEntry, ResolvedConfig, SignalRow } from '../../src/types'
import { alert, allowedPlugin, leveledAlert, resolvedConfig, signal } from '../helpers/config'
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
  const PLUGINS = [allowedPlugin('homebridge-example')]
  const STORE_PATH = (): string => join(dir, 'homebridge-pagerduty', 'signals-2026-10-24', 'signals.sqlite')

  function row(overrides: Partial<SignalRow> = {}): SignalRow {
    return { plugin: 'homebridge-example', signal: 'door', active: true, severity: 'warning', summary: 'Door open', updatedAt: 1, ...overrides }
  }

  function entry(plugin: string, name: string, summary = 'Door open'): CatalogEntry {
    return { plugin, signal: name, summary }
  }

  function rows(list: SignalRow[], extra: Partial<Extract<PollResult, { kind: 'rows' }>> = {}): PollResult {
    const catalog = list.map((item) => entry(item.plugin, item.signal, item.summary))
    return { kind: 'rows', rows: list, complete: true, catalog, invalidRows: 0, ...extra }
  }

  /** A reader that answers each poll from a script, then repeats the last answer as `unchanged`. */
  function scriptedReader(script: PollResult[], calls: string[] = []): ControllerOptions['createReader'] {
    return (path, allowed) => {
      calls.push(`open ${path} ${allowed.join(',')}`)
      const reader: SignalReaderLike = {
        create: () => {
          calls.push('create')
        },
        poll: () => script.shift() ?? { kind: 'unchanged' },
        close: () => undefined,
      }
      return reader
    }
  }

  it('pages for a row from an allowed plugin and resolves when it clears', async () => {
    const calls: string[] = []
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
      createReader: scriptedReader([rows([row()]), rows([row({ active: false })])], calls),
    })
    await flush()
    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning'])
    expect(calls).toEqual([`open ${STORE_PATH()} homebridge-example`, 'create'])

    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning', 'resolve homebridge/homebridge-example/door'])
    expect(h.controller.gauges().storeOk).toBe(true)
  })

  it('pages with the title and severity set in config, and the plugin text as detail', async () => {
    const settings = signal({ signal: 'door', summary: 'Zone Two door open', severity: 'critical' })
    const h = start(resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example', [settings])] }), {
      createReader: scriptedReader([rows([row()])]),
    })
    await flush()

    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door critical'])
    const body = h.api.bodies[0]!
    expect(body.event_action === 'trigger' && body.payload).toEqual(expect.objectContaining({
      summary: 'Zone Two door open',
      custom_details: { origin: 'signal', detail: 'Door open' },
    }))
  })

  it('drives a signal switch from the row, and pages or resolves when a person flips it', async () => {
    const settings = signal({ signal: 'door', switch: true, switchName: 'Zone Two' })
    const h = start(resolvedConfig({ alerts: [], signalPlugins: [allowedPlugin('homebridge-example', [settings])] }), {
      createReader: scriptedReader([rows([row()])]),
    })
    await flush()
    const ref = { plugin: 'homebridge-example', signal: 'door' }
    expect(h.controller.isSignalSwitchOn(ref)).toBe(true)

    h.controller.setSignalSwitch(ref, false)
    await flush()
    h.controller.setSignalSwitch(ref, true)
    await flush()

    expect(h.api.actions).toEqual([
      'trigger homebridge/homebridge-example/door warning',
      'resolve homebridge/homebridge-example/door',
      'trigger homebridge/homebridge-example/door warning',
    ])
    expect(h.log.lines('info')).toEqual(expect.arrayContaining(['Zone Two: switched off', 'Zone Two: switched on']))
    expect((await stateOnDisk(h)).switches['homebridge-example/door']).toEqual(expect.objectContaining({ on: true }))
  })

  it('ignores a switch write for a signal without a switch', async () => {
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), { createReader: scriptedReader([rows([])]) })

    h.controller.setSignalSwitch({ plugin: 'homebridge-example', signal: 'door' }, true)
    await flush()

    expect(h.api.bodies).toEqual([])
  })

  it('resolves what a plugin had open once it is no longer allowed', async () => {
    const first = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), { createReader: scriptedReader([rows([row()])]) })
    await flush()

    const config = resolvedConfig({ alerts: [], signalPlugins: [{ plugin: 'homebridge-example', allow: false, signals: [] }] })
    await first.controller.stop()
    running = running.filter((entry) => entry !== first.controller)
    const second = start(config, { api: first.api, createReader: scriptedReader([rows([row()])]) })
    await flush()

    expect(second.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning', 'resolve homebridge/homebridge-example/door'])
    expect((await stateOnDisk(second)).rowsSeen).toEqual({})
  })

  it('names each plugin that is not allowed once, logs invalid rows quietly, and an over-full store loudly', async () => {
    const other = entry('homebridge-other', 'x')
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
      createReader: scriptedReader([
        rows([], { catalog: [other], invalidRows: 2, complete: false }),
        rows([], { catalog: [other, entry('homebridge-other', 'y')] }),
      ]),
    })
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.log.lines('info').filter((line) => line.includes('homebridge-other'))).toEqual([
      'signal store: homebridge-other writes signals; allow it under Plugin Signals to page for it',
    ])
    expect(h.log.lines('debug')).toContain('signal store: 2 row(s) failed validation and were ignored')
    expect(h.log.lines('warn')).toContain('signal store holds more rows than are read; rows that have gone are not cleared until it shrinks')
  })

  function writeRetiredStore(plugins: string[]): void {
    mkdirSync(join(dir, 'homebridge-pagerduty'), { recursive: true })
    const sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule
    const db = new sqlite.DatabaseSync(join(dir, 'homebridge-pagerduty', 'signals.sqlite'))
    db.exec(SIGNAL_SCHEMA_SQL)
    for (const plugin of plugins) {
      db.prepare('INSERT INTO signals VALUES (?, ?, 1, ?, ?, 1)').run(plugin, 'door', 'warning', 'Door open')
    }
    db.close()
  }

  it('names each plugin that writes only to the 1.x store, which is not read', async () => {
    writeRetiredStore(['homebridge-example', 'homebridge-other', 'homebridge-third'])
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), { createReader: scriptedReader([rows([row()])]) })
    await flush()

    const advice = 'still writes to homebridge-pagerduty/signals.sqlite, which this version does not read, so it cannot page. '
      + 'Update it. Once nothing writes to it, delete it and its -wal and -shm files'
    expect(h.log.lines('warn')).toEqual([
      `signal store: homebridge-other ${advice}`,
      `signal store: homebridge-third ${advice}`,
    ])
    expect(h.api.actions).toEqual(['trigger homebridge/homebridge-example/door warning'])
  })

  it('says nothing about the 1.x store once every plugin in it writes to the current one', async () => {
    writeRetiredStore(['homebridge-example'])
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), { createReader: scriptedReader([rows([row()])]) })
    await flush()

    expect(h.log.lines('warn')).toEqual([])
  })

  it('keeps the last rows while the store is unreadable, opens the sensor after five minutes, and recovers', async () => {
    const unavailable: PollResult = { kind: 'unavailable', reason: 'file is not a database' }
    const script: PollResult[] = [rows([row()]), ...Array.from({ length: 151 }, () => unavailable), { kind: 'unchanged' }]
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), { createReader: scriptedReader(script) })
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
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
      createReader: scriptedReader([{ kind: 'unavailable', reason: 'busy' }, rows([])]),
    })
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.log.lines('warn')).toEqual([])
    expect(h.log.lines('debug')).toContain('signal store unavailable (busy); keeping the last rows read')
    expect(h.log.lines('info')).not.toContain('signal store readable again')
  })

  it('lists every plugin\'s signals, and reports a change only when a name comes or goes', () => {
    const script = [
      rows([], { catalog: [entry('homebridge-other', 'x')] }),
      rows([], { catalog: [entry('homebridge-other', 'x', 'New text')] }),
      rows([], { catalog: [entry('homebridge-other', 'x'), entry('homebridge-other', 'y')] }),
    ]
    const h = start(resolvedConfig({ alerts: [] }), { createReader: scriptedReader(script) })
    let changes = 0
    h.controller.onCatalogChange(() => {
      changes += 1
    })
    expect(h.controller.signalCatalog()).toEqual([entry('homebridge-other', 'x')])

    jest.advanceTimersByTime(4_000)

    expect(changes).toBe(1)
    expect(h.controller.signalCatalog()).toHaveLength(2)
  })

  it('keeps going when a catalog listener throws', () => {
    const h = start(resolvedConfig({ alerts: [] }), {
      createReader: scriptedReader([{ kind: 'unavailable', reason: 'missing' }, rows([], { catalog: [entry('homebridge-other', 'x')] })]),
    })
    h.controller.onCatalogChange(() => {
      throw new Error('listener failed')
    })

    jest.advanceTimersByTime(2_000)

    expect(h.log.lines('debug')).toContain('catalog listener failed: listener failed')
  })

  it('reads a missing store as empty and an unreadable one as unknown', () => {
    const config = resolvedConfig({ alerts: [], signalPlugins: PLUGINS })
    const missing = start(config, { createReader: scriptedReader([{ kind: 'unavailable', reason: 'missing' }]) })
    expect(missing.controller.signalCatalog()).toEqual([])

    const broken = start(config, { createReader: scriptedReader([{ kind: 'unavailable', reason: 'file is not a database' }]) })
    expect(broken.controller.signalCatalog()).toBeUndefined()
  })

  it('with no plugin allowed, reads the store without creating it, and never counts it as a fault', async () => {
    const calls: string[] = []
    const h = start(resolvedConfig({ alerts: [] }), {
      createReader: scriptedReader([{ kind: 'unavailable', reason: 'missing' }, { kind: 'unavailable', reason: 'file is not a database' }], calls),
    })
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(calls).toEqual([`open ${STORE_PATH()} `])
    expect(h.log.lines('warn')).toEqual([])
    expect(h.log.lines('debug')).toContain('signal store unavailable (file is not a database)')
    expect(h.controller.gauges().storeOk).toBeNull()
  })

  it('treats a store that cannot be created as unavailable', async () => {
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
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
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
      createReader: scriptedReader([rows([row({ active: false })])]),
    })
    await flush()

    expect(h.api.actions).toEqual(['resolve homebridge/homebridge-example/door'])
  })

  it('persists a summary-only change without sending anything', async () => {
    const h = start(resolvedConfig({ alerts: [], signalPlugins: PLUGINS }), {
      createReader: scriptedReader([rows([row()]), rows([row({ summary: 'Still open', updatedAt: 2 })])]),
    })
    await flush()
    jest.advanceTimersByTime(2_000)
    await flush()

    expect(h.api.bodies).toHaveLength(1)
    expect((await stateOnDisk(h)).rowsSeen['homebridge-example/door']!.summary).toBe('Still open')
  })
})
