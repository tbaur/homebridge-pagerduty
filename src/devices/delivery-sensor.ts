/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview A contact sensor that opens when pages are not going out.
 *
 * A contact sensor because HomeKit sends a notification when one opens and
 * can trigger an automation from it, which is the one channel left when the
 * paging service itself is unreachable.
 */

import type { Service } from 'homebridge'

import { BaseAccessory } from './base-accessory'
import type { AccessoryInit } from './host'

/** PagerDuty delivery health, as a HomeKit contact sensor. */
export class DeliverySensor extends BaseAccessory {
  private readonly service: Service

  /** The state last logged, so a standing fault is reported once. */
  private lastFault: boolean | undefined

  constructor(init: AccessoryInit) {
    super(init)
    const { Characteristic, Service: HapService } = this.host.hap
    this.service = this.requireService(HapService.ContactSensor)
    this.service.setCharacteristic(Characteristic.Name, this.displayName)
    this.service
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => {
        this.requireAvailable()
        return this.stateFor(this.host.isDeliveryFault())
      })
  }

  protected override publishState(): void {
    const fault = this.host.isDeliveryFault()
    this.publish(this.service, this.host.hap.Characteristic.ContactSensorState, this.stateFor(fault))
    if (fault === this.lastFault) {
      return
    }
    const previous = this.lastFault
    this.lastFault = fault
    if (fault) {
      this.host.log.warn('pages are not going out; delivery sensor open')
    } else if (previous !== undefined) {
      this.host.log.info('pages are going out again; delivery sensor closed')
    }
  }

  /** "Detected" is HomeKit's word for a closed contact, the resting state. */
  private stateFor(fault: boolean): number {
    const { ContactSensorState } = this.host.hap.Characteristic
    return fault ? ContactSensorState.CONTACT_NOT_DETECTED : ContactSensorState.CONTACT_DETECTED
  }
}
