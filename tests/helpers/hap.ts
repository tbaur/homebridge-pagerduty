/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview A HAP stand-in for accessory and platform tests.
 *
 * Enough of HAP to exercise real accessory code without HAP-NodeJS: services
 * that remember their characteristics, characteristics that remember their
 * handlers and their last pushed value, and an accessory that behaves like a
 * restored one. Handlers are invoked directly, the way HomeKit would.
 */

import type { API, HAP, PlatformAccessory, Service } from 'homebridge'

import type { AccessoryHost, AccessoryInit } from '../../src/devices/host'
import type { PluginLogger, Severity, SignalRef } from '../../src/types'

/** A recorded characteristic. */
export class FakeCharacteristic {
  getHandler: (() => unknown) | undefined

  setHandler: ((value: unknown) => Promise<void> | void) | undefined

  /** Every value pushed, in order. */
  readonly updates: unknown[] = []

  constructor(readonly name: string) {}

  onGet(handler: () => unknown): this {
    this.getHandler = handler
    return this
  }

  onSet(handler: (value: unknown) => Promise<void> | void): this {
    this.setHandler = handler
    return this
  }

  /** Most recent pushed value. */
  get value(): unknown {
    return this.updates[this.updates.length - 1]
  }

  /** Invoke the read handler the way HomeKit would. */
  read(): unknown {
    if (this.getHandler === undefined) {
      throw new Error(`${this.name} has no read handler`)
    }
    return this.getHandler()
  }

  /** Invoke the write handler the way HomeKit would. */
  async write(value: unknown): Promise<void> {
    if (this.setHandler === undefined) {
      throw new Error(`${this.name} has no write handler`)
    }
    await this.setHandler(value)
  }
}

/** A service that remembers its characteristics. Keys are coerced with `String`. */
export class FakeService {
  private readonly byName = new Map<string, FakeCharacteristic>()

  constructor(readonly UUID: string, public displayName?: string) {}

  getCharacteristic(name: unknown): FakeCharacteristic {
    const key = String(name)
    const existing = this.byName.get(key)
    if (existing !== undefined) {
      return existing
    }
    const created = new FakeCharacteristic(key)
    this.byName.set(key, created)
    return created
  }

  setCharacteristic(name: unknown, value: unknown): this {
    this.getCharacteristic(name).updates.push(value)
    return this
  }

  updateCharacteristic(name: unknown, value: unknown): this {
    this.getCharacteristic(name).updates.push(value)
    return this
  }

  /** The last value pushed to a characteristic. */
  lastValue(name: unknown): unknown {
    return this.byName.get(String(name))?.value
  }
}

/** Thrown in place of HAP's own, so tests can recognise a refused read. */
export class FakeHapStatusError extends Error {
  constructor(readonly hapStatus: number) {
    super(`HapStatusError:${hapStatus}`)
    this.name = 'HapStatusError'
  }
}

function serviceConstructor(name: string): new (displayName?: string) => Service {
  const constructor = class extends FakeService {
    constructor(displayName?: string) {
      super(name, displayName)
    }
  }
  Object.defineProperty(constructor, 'UUID', { value: name })
  return constructor as unknown as new (displayName?: string) => Service
}

const SERVICE_NAMES = ['AccessoryInformation', 'ContactSensor', 'Switch'] as const

/** HAP's `Characteristic` namespace, reduced to the names this plugin uses. */
export const characteristics = {
  ContactSensorState: Object.assign('ContactSensorState', { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 }),
  FirmwareRevision: 'FirmwareRevision',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  Name: 'Name',
  On: 'On',
  SerialNumber: 'SerialNumber',
}

/** The HAP status code that makes the Home app show No Response. */
export const SERVICE_COMMUNICATION_FAILURE = -70402

export function fakeHap(): HAP {
  const services: Record<string, unknown> = {}
  for (const name of SERVICE_NAMES) {
    services[name] = serviceConstructor(name)
  }
  return {
    Service: services,
    Characteristic: characteristics,
    HapStatusError: FakeHapStatusError,
    HAPStatus: { SERVICE_COMMUNICATION_FAILURE },
    uuid: { generate: (seed: string) => `uuid:${seed}` },
  } as unknown as HAP
}

/** A restored `PlatformAccessory`, with services that persist across handlers. */
export class FakeAccessory {
  readonly services: FakeService[] = []

  readonly displayNameUpdates: string[] = []

  /** Homebridge's own signature, so this can stand in for `platformAccessory`. */
  constructor(
    public displayName: string,
    public UUID = 'uuid:test',
    public context: Record<string, unknown> = {},
  ) {}

  updateDisplayName(name: string): void {
    this.displayNameUpdates.push(name)
    this.displayName = name
  }

  getService(type: unknown): FakeService | undefined {
    const uuid = typeof type === 'string' ? type : (type as { UUID: string }).UUID
    return this.services.find((service) => service.UUID === uuid)
  }

  addService(service: unknown): FakeService {
    const instance = typeof service === 'function'
      ? new (service as new () => FakeService)()
      : service as FakeService
    this.services.push(instance)
    return instance
  }

  /** The one service of this type, or a failure naming it. */
  service(name: string): FakeService {
    const found = this.getService(name)
    if (found === undefined) {
      throw new Error(`no ${name} service was created`)
    }
    return found
  }
}

export type RecordingLogger = PluginLogger & { calls: string[]; lines(level: string): string[] }

export function fakeLogger(): RecordingLogger {
  const calls: string[] = []
  return {
    calls,
    info: (message: string) => calls.push(`info ${message}`),
    warn: (message: string) => calls.push(`warn ${message}`),
    error: (message: string) => calls.push(`error ${message}`),
    debug: (message: string) => calls.push(`debug ${message}`),
    lines: (level: string) => calls
      .filter((line) => line.startsWith(`${level} `))
      .map((line) => line.slice(level.length + 1)),
  }
}

/** A host whose state is a few plain fields, plus a record of every write. */
export interface FakeHost extends AccessoryHost {
  log: RecordingLogger
  levels: Map<string, boolean>
  signals: Map<string, boolean>
  maintenance: boolean
  fault: boolean
  writes: string[]
}

export function fakeHost(): FakeHost {
  const hap = fakeHap()
  const host: FakeHost = {
    api: { hap } as unknown as API,
    hap,
    log: fakeLogger(),
    pluginVersion: '1.2.3',
    levels: new Map(),
    signals: new Map(),
    maintenance: false,
    fault: false,
    writes: [],
    isLevelOn: (alertId: string, severity: Severity) => host.levels.get(`${alertId}:${severity}`) === true,
    setLevel: (alertId: string, severity: Severity, on: boolean) => {
      host.writes.push(`level ${alertId}:${severity} ${on}`)
      host.levels.set(`${alertId}:${severity}`, on)
    },
    isSignalSwitchOn: (ref: SignalRef) => host.signals.get(`${ref.plugin}/${ref.signal}`) === true,
    setSignalSwitch: (ref: SignalRef, on: boolean) => {
      host.writes.push(`signal ${ref.plugin}/${ref.signal} ${on}`)
      host.signals.set(`${ref.plugin}/${ref.signal}`, on)
    },
    isMaintenanceOn: () => host.maintenance,
    setMaintenance: (on: boolean) => {
      host.writes.push(`maintenance ${on}`)
      host.maintenance = on
    },
    isDeliveryFault: () => host.fault,
  }
  return host
}

/** Everything an accessory constructor needs. */
export function accessoryInit(host: AccessoryHost, overrides: Partial<AccessoryInit> = {}): AccessoryInit & { fake: FakeAccessory } {
  const fake = new FakeAccessory(overrides.displayName ?? 'Zone One Leak')
  return {
    host,
    accessory: fake as unknown as PlatformAccessory,
    displayName: fake.displayName,
    model: 'Alert Switch',
    serialNumber: 'SERIAL-0001',
    unavailable: false,
    ...overrides,
    fake: overrides.accessory === undefined ? fake : overrides.accessory as unknown as FakeAccessory,
  }
}
