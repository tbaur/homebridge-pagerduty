/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview One severity level of one alert, as a HomeKit switch.
 *
 * Each level is its own accessory, not a second service on one accessory. The
 * Home app groups the services of one accessory into one tile, and tapping a
 * grouped tile turns all of its switches on at once, which would page at the
 * highest severity by accident.
 *
 * On means "this condition is present". A write updates desired state and
 * returns; the reconciler decides what, if anything, goes to PagerDuty.
 */

import type { CharacteristicValue, Service } from 'homebridge'

import type { Severity } from '../types'
import { BaseAccessory } from './base-accessory'
import type { AccessoryInit } from './host'

/** One level switch. */
export class AlertSwitch extends BaseAccessory {
  private readonly service: Service

  readonly alertId: string

  readonly severity: Severity

  constructor(init: AccessoryInit & { alertId: string; severity: Severity }) {
    super(init)
    this.alertId = init.alertId
    this.severity = init.severity
    const { Characteristic, Service: HapService } = this.host.hap
    this.service = this.requireService(HapService.Switch)
    this.service.setCharacteristic(Characteristic.Name, this.displayName)
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.readOn())
      .onSet((value) => this.writeOn(value))
  }

  private readOn(): boolean {
    this.requireAvailable()
    return this.host.isLevelOn(this.alertId, this.severity)
  }

  private writeOn(value: CharacteristicValue): void {
    this.requireAvailable()
    this.host.setLevel(this.alertId, this.severity, value === true)
  }

  protected override publishState(): void {
    this.publish(this.service, this.host.hap.Characteristic.On, this.host.isLevelOn(this.alertId, this.severity))
  }
}
