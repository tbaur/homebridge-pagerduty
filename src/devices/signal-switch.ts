/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview A switch for one signal from another plugin.
 *
 * On while the signal is active. Turning it on by hand pages with the signal's
 * settings, and the next change the other plugin writes sets it again.
 */

import type { CharacteristicValue, Service } from 'homebridge'

import type { SignalRef } from '../types'
import { BaseAccessory } from './base-accessory'
import type { AccessoryInit } from './host'

/** One signal's switch. */
export class SignalSwitch extends BaseAccessory {
  private readonly service: Service

  readonly signal: SignalRef

  constructor(init: AccessoryInit & { signal: SignalRef }) {
    super(init)
    this.signal = init.signal
    const { Characteristic, Service: HapService } = this.host.hap
    this.service = this.requireService(HapService.Switch)
    this.service.setCharacteristic(Characteristic.Name, this.displayName)
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => {
        this.requireAvailable()
        return this.host.isSignalSwitchOn(this.signal)
      })
      .onSet((value: CharacteristicValue) => {
        this.requireAvailable()
        this.host.setSignalSwitch(this.signal, value === true)
      })
  }

  protected override publishState(): void {
    this.publish(this.service, this.host.hap.Characteristic.On, this.host.isSignalSwitchOn(this.signal))
  }
}
