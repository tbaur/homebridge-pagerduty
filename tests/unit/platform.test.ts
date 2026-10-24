/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The platform decides which accessories exist. Its failures are the ones a
 * user cannot undo: a tile removed by a config typo takes its room, scenes
 * and automations with it. The HTTP layer is replaced, so nothing here can
 * reach PagerDuty.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'

import { AlertController } from '../../src/controller'
import { postJson } from '../../src/delivery/http'
import { PagerDutyPlatform } from '../../src/platform'
import { characteristics, FakeAccessory, FakeHapStatusError, fakeHap } from '../helpers/hap'
import { FAKE_ROUTING_KEY } from '../helpers/secrets'
import { accepted } from '../helpers/transport'

jest.mock('../../src/delivery/http', () => ({ postJson: jest.fn() }))

const post = postJson as jest.MockedFunction<typeof postJson>

interface FakeApi {
  api: API
  registered: FakeAccessory[]
  unregistered: FakeAccessory[]
  launch(): void
  shutdown(): Promise<void>
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-platform-'))
  post.mockImplementation(() => Promise.resolve(accepted()))
})

afterEach(() => {
  jest.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function fakeApi(): FakeApi {
  const registered: FakeAccessory[] = []
  const unregistered: FakeAccessory[] = []
  const handlers = new Map<string, (() => void)[]>()
  const api = {
    hap: fakeHap(),
    platformAccessory: FakeAccessory,
    user: { storagePath: () => dir },
    on: (event: string, handler: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerPlatformAccessories: (_plugin: string, _platform: string, accessories: FakeAccessory[]) => {
      registered.push(...accessories)
    },
    unregisterPlatformAccessories: (_plugin: string, _platform: string, accessories: FakeAccessory[]) => {
      unregistered.push(...accessories)
    },
  } as unknown as API
  return {
    api,
    registered,
    unregistered,
    launch: () => {
      for (const handler of handlers.get('didFinishLaunching') ?? []) {
        handler()
      }
    },
    shutdown: async () => {
      // Homebridge does not await shutdown, but the test must: the final state
      // write is real disk I/O, and cleanup would race it on a slow runner.
      const stops = jest.spyOn(AlertController.prototype, 'stop')
      for (const handler of handlers.get('shutdown') ?? []) {
        handler()
      }
      await Promise.all(stops.mock.results.map((result) => result.value))
      stops.mockRestore()
      for (let index = 0; index < 8; index += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    },
  }
}

function fakeLog(): Logging & { calls: string[] } {
  const calls: string[] = []
  const record = (level: string) => (message: unknown) => {
    calls.push(`${level} ${String(message)}`)
  }
  const log = record('info') as unknown as Logging & { calls: string[] }
  log.info = record('info')
  log.warn = record('warn')
  log.error = record('error')
  log.debug = record('debug')
  log.success = record('info')
  log.calls = calls
  return log
}

function config(overrides: Record<string, unknown> = {}): PlatformConfig {
  return {
    platform: 'PagerDuty',
    name: 'PagerDuty',
    routingKey: FAKE_ROUTING_KEY,
    alerts: [{ id: 'leak', name: 'Zone One Leak', summary: 'Water detected', levels: [{ severity: 'critical' }] }],
    maintenance: { switch: true },
    ...overrides,
  } as PlatformConfig
}

function cached(name: string, identity: string, context: Record<string, unknown>): FakeAccessory {
  return new FakeAccessory(name, `uuid:homebridge-pagerduty:${identity}`, { serialNumber: 'SERIAL-0001', ...context })
}

function create(platformConfig: PlatformConfig, restored: FakeAccessory[] = [], fake = fakeApi()): { fake: FakeApi; log: Logging & { calls: string[] }; platform: PagerDutyPlatform } {
  const log = fakeLog()
  const platform = new PagerDutyPlatform(log, platformConfig, fake.api)
  for (const accessory of restored) {
    platform.configureAccessory(accessory as unknown as PlatformAccessory)
  }
  return { fake, log, platform }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function onOf(accessory: FakeAccessory) {
  return accessory.service('Switch').getCharacteristic(characteristics.On)
}

describe('when not configured', () => {
  it('logs one line, starts nothing, and keeps cached accessories answering No Response', async () => {
    const restored = cached('Zone One Leak', 'alert:leak:critical', { kind: 'alert', alertId: 'leak', severity: 'critical' })
    const { fake, log } = create(config({ routingKey: '' }), [restored])

    fake.launch()

    expect(log.calls.filter((line) => line.startsWith('info '))).toEqual([
      'info no routingKey set; PagerDuty is not started',
    ])
    expect(log.calls).toContain('warn 1 cached accessory(ies) inactive')
    expect(fake.registered).toEqual([])
    expect(fake.unregistered).toEqual([])
    expect(() => onOf(restored).read()).toThrow(FakeHapStatusError)
    await fake.shutdown()
  })
})

describe('when the config is invalid', () => {
  it('disables itself and keeps cached accessories', () => {
    const restored = cached('PagerDuty Maintenance', 'maintenance', { kind: 'maintenance' })
    const { fake, log } = create(config({ routingKey: 'not-a-key' }), [restored])

    fake.launch()

    expect(log.calls).toContain('error routingKey is not a 32-character PagerDuty integration key')
    expect(log.calls).toContain('error platform disabled; cached accessories kept')
    expect(log.calls).not.toContain('info Platform ready')
    expect(fake.unregistered).toEqual([])
    expect(() => onOf(restored).read()).toThrow(FakeHapStatusError)
  })

  it('logs nothing about cached accessories when there are none', () => {
    const { fake, log } = create(config({ routingKey: 'not-a-key' }))

    fake.launch()

    expect(log.calls.some((line) => line.includes('inactive'))).toBe(false)
  })
})

describe('a second instance', () => {
  it('refuses to start on the same Homebridge', async () => {
    const first = create(config())
    const second = create(config(), [], first.fake)

    expect(second.log.calls).toEqual(['error a second PagerDuty platform is configured; only one is supported per Homebridge. This one is disabled'])
    first.fake.launch()
    await first.fake.shutdown()
  })
})

describe('when configured', () => {
  it('registers a switch per level, the maintenance switch and the delivery sensor', async () => {
    const { fake, log } = create(config())

    fake.launch()

    expect(fake.registered.map((accessory) => [accessory.displayName, accessory.UUID])).toEqual([
      ['Zone One Leak', 'uuid:homebridge-pagerduty:alert:leak:critical'],
      ['PagerDuty Maintenance', 'uuid:homebridge-pagerduty:maintenance'],
      ['PagerDuty Delivery', 'uuid:homebridge-pagerduty:delivery'],
    ])
    const startup = log.calls.slice(log.calls.findIndex((line) => line.startsWith('info Starting v')))
    expect(startup).toEqual([
      expect.stringMatching(/^info Starting v\S+: region US, source homebridge$/),
      'info Alert switch: leak "Water detected" (critical)',
      'info Maintenance switch: PagerDuty Maintenance (new); turns off after 240 min',
      'info Delivery sensor: PagerDuty Delivery (new)',
      'info Platform ready',
    ])
    await fake.shutdown()
  })

  it('reports restored accessories without the new tag, and says ready last', async () => {
    const restored = cached('PagerDuty Maintenance', 'maintenance', { kind: 'maintenance' })
    const { fake, log } = create(config({ options: { diagnosticsInterval: 30 } }), [restored])

    fake.launch()

    expect(log.calls).toContain('info Maintenance switch: PagerDuty Maintenance; turns off after 240 min')
    const diagnostics = log.calls.findIndex((line) => line.startsWith('info Diagnostics start:'))
    expect(diagnostics).toBeGreaterThan(-1)
    expect(log.calls.indexOf('info Platform ready')).toBe(diagnostics + 1)
    expect(log.calls.at(-1)).toBe('info Platform ready')
    await fake.shutdown()
  })

  it('pages from a HomeKit write and shows the new state', async () => {
    const { fake } = create(config())
    fake.launch()
    const leak = fake.registered[0]!

    await onOf(leak).write(true)
    await settle()

    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]![1]).toEqual(expect.objectContaining({ event_action: 'trigger', dedup_key: 'homebridge/leak' }))
    expect(onOf(leak).read()).toBe(true)
    expect(onOf(leak).value).toBe(true)

    const maintenance = fake.registered[1]!
    await onOf(maintenance).write(true)
    expect(onOf(maintenance).read()).toBe(true)
    expect(fake.registered[2]!.service('ContactSensor').getCharacteristic(characteristics.ContactSensorState).read()).toBe(0)
    await fake.shutdown()
  })

  it('adopts a cached accessory, renaming it in place', async () => {
    const restored = cached('Old Name', 'alert:leak:critical', { kind: 'alert', alertId: 'leak', severity: 'critical' })
    const { fake, log } = create(config(), [restored])

    fake.launch()

    expect(fake.registered.map((accessory) => accessory.displayName)).toEqual(['PagerDuty Maintenance', 'PagerDuty Delivery'])
    expect(restored.displayNameUpdates).toEqual(['Zone One Leak'])
    expect(restored.context.serialNumber).toBe('SERIAL-0001')
    expect(log.calls).toContain('info Alert switch: leak "Water detected" (critical; renamed Old Name to Zone One Leak)')
    expect(log.calls.filter((line) => line.includes('Old Name'))).toHaveLength(1)
    await fake.shutdown()
  })

  it('renames the maintenance switch and delivery sensor in place, keeping their HomeKit identity', async () => {
    const maintenance = cached('PagerDuty Maintenance', 'maintenance', { kind: 'maintenance' })
    const delivery = cached('PagerDuty Delivery', 'delivery', { kind: 'delivery' })
    const { fake, log } = create(config({
      maintenance: { switch: true, name: 'House Work' },
      options: { deliveryFaultSensorName: 'Paging Health' },
    }), [maintenance, delivery])

    fake.launch()

    expect(maintenance.displayNameUpdates).toEqual(['House Work'])
    expect(delivery.displayNameUpdates).toEqual(['Paging Health'])
    expect(log.calls).toContain('info Maintenance switch: House Work (renamed from PagerDuty Maintenance); turns off after 240 min')
    expect(log.calls).toContain('info Delivery sensor: Paging Health (renamed from PagerDuty Delivery)')
    expect(fake.unregistered).toEqual([])
    expect(fake.registered.map((accessory) => accessory.displayName)).toEqual(['Zone One Leak'])
    await fake.shutdown()
  })

  it('removes only accessories whose alert was removed from config', async () => {
    const stale = cached('Smoke', 'alert:smoke:critical', { kind: 'alert', alertId: 'smoke', severity: 'critical' })
    const delivery = cached('PagerDuty Delivery', 'delivery', { kind: 'delivery' })
    const { fake, log } = create(config({ options: { deliveryFaultSensor: false } }), [stale, delivery])

    fake.launch()

    expect(fake.unregistered).toEqual([stale, delivery])
    expect(log.calls).toContain('info removing Smoke')
    await fake.shutdown()
  })

  it('keeps a held alert\'s accessory registered, answering No Response', async () => {
    const held = cached('Freezer', 'alert:freezer:critical', { kind: 'alert', alertId: 'freezer', severity: 'critical' })
    const alerts = [
      { id: 'leak', name: 'Zone One Leak', summary: 'Water detected', levels: [{ severity: 'critical' }] },
      { id: 'freezer', name: 'Freezer', summary: '', levels: [{ severity: 'critical' }] },
    ]
    const { fake, log } = create(config({ alerts }), [held])

    fake.launch()

    expect(fake.unregistered).toEqual([])
    expect(() => onOf(held).read()).toThrow(FakeHapStatusError)
    expect(log.calls.some((line) => line.startsWith('warn alert freezer is held until fixed'))).toBe(true)
    await fake.shutdown()
  })

  it('ignores a cached accessory with an unreadable context', async () => {
    const broken = new FakeAccessory('Mystery', 'uuid:other', { kind: 'thermostat' })
    const { fake } = create(config({ routingKey: undefined }), [broken])

    fake.launch()

    expect(broken.services).toEqual([])
    await fake.shutdown()
  })

  it('warns about duplicate names', async () => {
    const alerts = [
      { id: 'a', name: 'Same', summary: 's', levels: [{ severity: 'critical' }] },
      { id: 'b', name: 'Same', summary: 's', levels: [{ severity: 'critical' }] },
    ]
    const { fake, log } = create(config({ alerts }))

    fake.launch()

    expect(log.calls).toContain('warn duplicate name: Same (2)')
    await fake.shutdown()
  })

  it('says when it is a dry run', async () => {
    const { fake, log } = create(config({ options: { dryRun: true } }))

    fake.launch()

    expect(log.calls.some((line) => /^info Starting v\S+ \(dry run: nothing is sent\): /.test(line))).toBe(true)
    await fake.shutdown()
  })

  it('disables itself, keeping cached accessories, when the state file cannot be read', () => {
    mkdirSync(join(dir, 'homebridge-pagerduty', 'state.json'), { recursive: true })
    const restored = cached('Zone One Leak', 'alert:leak:critical', { kind: 'alert', alertId: 'leak', severity: 'critical' })
    const { fake, log } = create(config(), [restored])

    fake.launch()

    expect(log.calls.some((line) => line.startsWith('error saved state could not be loaded: state file could not be read'))).toBe(true)
    expect(log.calls).not.toContain('info Platform ready')
    expect(fake.registered).toEqual([])
    expect(() => onOf(restored).read()).toThrow(FakeHapStatusError)
  })
})

describe('diagnostics', () => {
  it('logs start, heartbeat, health transitions and stop, with JSON when asked', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate'] })
    post.mockImplementation(() => Promise.resolve({ status: 503, body: '', headers: {} }))
    const { fake, log } = create(config({ options: { diagnosticsInterval: 30, structuredLogs: true } }))
    fake.launch()
    expect(log.calls.filter((line) => line.startsWith('info Diagnostics start: healthy'))).toHaveLength(1)

    jest.advanceTimersByTime(30_000)
    const leak = fake.registered[0]!
    await onOf(leak).write(true)
    await settle()
    jest.advanceTimersByTime(30_000)
    await fake.shutdown()

    expect(log.calls).toContain('warn Health degraded: degraded [pagerDutyUnreachable]')
    expect(log.calls.some((line) => line.startsWith('info Health: healthy | open 0'))).toBe(true)
    expect(log.calls.some((line) => line.startsWith('info Diagnostics stop: degraded'))).toBe(true)
    expect(log.calls.some((line) => line.startsWith('info {"msg":"diagnostics.start"'))).toBe(true)
    expect(log.calls.join('\n')).not.toContain(FAKE_ROUTING_KEY)
  })

  it('logs a recovery when health returns', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate'] })
    post.mockImplementationOnce(() => Promise.resolve({ status: 400, body: '', headers: {} }))
    const { fake, log } = create(config({ options: { diagnosticsInterval: 30 } }))
    fake.launch()
    const leak = fake.registered[0]!

    await onOf(leak).write(true)
    await settle()
    jest.advanceTimersByTime(30_000)
    await onOf(leak).write(false)
    await settle()
    jest.advanceTimersByTime(30_000)
    await fake.shutdown()

    expect(log.calls).toContain('warn Health degraded: degraded [deliveryFault, eventRejected]')
    expect(log.calls).toContain('info Health recovered: healthy')
  })
})
