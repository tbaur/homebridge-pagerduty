/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The accessories are thin: a write changes desired state and returns. What
 * these tests guard is the HomeKit contract around that: the identity that is
 * published, reuse of a restored service, and No Response when unavailable.
 */

import type { PlatformAccessory } from 'homebridge'

import { AlertSwitch, DeliverySensor, MaintenanceSwitch, SignalSwitch } from '../../../src/devices'
import {
  accessoryInit,
  characteristics,
  FakeAccessory,
  FakeHapStatusError,
  fakeHost,
  SERVICE_COMMUNICATION_FAILURE,
} from '../../helpers/hap'

describe('BaseAccessory, through AlertSwitch', () => {
  it('publishes accessory information from resolved values', () => {
    const init = accessoryInit(fakeHost())

    new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })

    const info = init.fake.service('AccessoryInformation')
    expect(info.lastValue('Manufacturer')).toBe('homebridge-pagerduty')
    expect(info.lastValue('Model')).toBe('Alert Switch')
    expect(info.lastValue('SerialNumber')).toBe('SERIAL-0001')
    expect(info.lastValue('FirmwareRevision')).toBe('1.2.3')
    expect(info.lastValue('Name')).toBe('Zone One Leak')
  })

  it('reuses a restored service rather than adding a second one', () => {
    const host = fakeHost()
    const restored = new FakeAccessory('Zone One Leak')
    const init = accessoryInit(host, { accessory: restored as unknown as PlatformAccessory })
    new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })

    new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })

    expect(restored.services.map((service) => service.UUID)).toEqual(['AccessoryInformation', 'Switch'])
  })

  it('ignores refresh after stop', () => {
    const host = fakeHost()
    const init = accessoryInit(host)
    const subject = new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })
    subject.stop()
    host.levels.set('leak:critical', true)

    subject.refresh()

    expect(init.fake.service('Switch').lastValue('On')).toBeUndefined()
  })
})

describe('AlertSwitch', () => {
  it('reads and writes its level through the host', async () => {
    const host = fakeHost()
    const init = accessoryInit(host)
    new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    expect(on.read()).toBe(false)
    await on.write(true)
    expect(host.writes).toEqual(['level leak:critical true'])
    expect(on.read()).toBe(true)
  })

  it('publishes only actual changes', () => {
    const host = fakeHost()
    const init = accessoryInit(host)
    const subject = new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    subject.refresh()
    subject.refresh()
    host.levels.set('leak:critical', true)
    subject.refresh()

    expect(on.updates).toEqual([false, true])
  })

  it('answers No Response and refuses writes when unavailable', async () => {
    const host = fakeHost()
    const init = accessoryInit(host, { unavailable: true })
    const subject = new AlertSwitch({ ...init, alertId: 'leak', severity: 'critical' })
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    expect(() => on.read()).toThrow(new FakeHapStatusError(SERVICE_COMMUNICATION_FAILURE))
    await expect(on.write(true)).rejects.toThrow(FakeHapStatusError)
    subject.refresh()
    expect(host.writes).toEqual([])
    expect(on.updates).toEqual([])
  })
})

describe('MaintenanceSwitch', () => {
  it('reads, writes and publishes maintenance', async () => {
    const host = fakeHost()
    const init = accessoryInit(host, { displayName: 'PagerDuty Maintenance', model: 'Maintenance Switch' })
    const subject = new MaintenanceSwitch(init)
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    await on.write(true)
    expect(host.writes).toEqual(['maintenance true'])
    expect(on.read()).toBe(true)
    subject.refresh()
    expect(on.value).toBe(true)
  })

  it('answers No Response when unavailable', async () => {
    const init = accessoryInit(fakeHost(), { unavailable: true })
    new MaintenanceSwitch(init)
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    expect(() => on.read()).toThrow(FakeHapStatusError)
    await expect(on.write(true)).rejects.toThrow(FakeHapStatusError)
  })
})

describe('SignalSwitch', () => {
  const signal = { plugin: 'homebridge-example', signal: 'door' }

  it('reads, writes and publishes its signal through the host', async () => {
    const host = fakeHost()
    const init = accessoryInit(host, { displayName: 'Zone Two', model: 'Signal Switch' })
    const subject = new SignalSwitch({ ...init, signal })
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    expect(on.read()).toBe(false)
    await on.write(true)
    expect(host.writes).toEqual(['signal homebridge-example/door true'])
    expect(on.read()).toBe(true)
    subject.refresh()
    expect(on.value).toBe(true)
    expect(init.fake.service('AccessoryInformation').lastValue('Model')).toBe('Signal Switch')
  })

  it('answers No Response and refuses writes when unavailable', async () => {
    const host = fakeHost()
    const init = accessoryInit(host, { unavailable: true })
    new SignalSwitch({ ...init, signal })
    const on = init.fake.service('Switch').getCharacteristic(characteristics.On)

    expect(() => on.read()).toThrow(FakeHapStatusError)
    await expect(on.write(true)).rejects.toThrow(FakeHapStatusError)
    expect(host.writes).toEqual([])
  })
})

describe('DeliverySensor', () => {
  it('is closed while pages go out and opens on a fault, logging each change once', () => {
    const host = fakeHost()
    const init = accessoryInit(host, { displayName: 'PagerDuty Delivery', model: 'Delivery Sensor' })
    const subject = new DeliverySensor(init)
    const state = init.fake.service('ContactSensor').getCharacteristic(characteristics.ContactSensorState)

    subject.refresh()
    expect(state.read()).toBe(0)
    expect(host.log.calls).toEqual([])

    host.fault = true
    subject.refresh()
    subject.refresh()
    expect(state.value).toBe(1)
    expect(state.read()).toBe(1)

    host.fault = false
    subject.refresh()
    expect(host.log.calls).toEqual([
      'warn pages are not going out; delivery sensor open',
      'info pages are going out again; delivery sensor closed',
    ])
  })

  it('says that other pages still send when the only fault is a rejection', () => {
    const host = fakeHost()
    host.faultReport = 'rejected'
    const init = accessoryInit(host, { displayName: 'PagerDuty Delivery', model: 'Delivery Sensor' })
    const subject = new DeliverySensor(init)

    host.fault = true
    subject.refresh()
    subject.refresh()

    expect(host.log.calls).toEqual([
      'warn PagerDuty rejected a page; delivery sensor open. Other pages still send',
    ])
  })

  it('answers No Response when unavailable', () => {
    const init = accessoryInit(fakeHost(), { unavailable: true })
    new DeliverySensor(init)

    expect(() => init.fake.service('ContactSensor').getCharacteristic(characteristics.ContactSensorState).read())
      .toThrow(FakeHapStatusError)
  })
})
