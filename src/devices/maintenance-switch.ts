/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The maintenance switch.
 *
 * While on, new triggers and severity raises are held and sent afterwards if
 * the condition is still present. Resolves are always sent. It turns itself
 * off after `maintenance.maxMinutes`, because a forgotten maintenance switch
 * silently disables paging.
 */

import type { CharacteristicValue, Service } from 'homebridge'

import { BaseAccessory } from './base-accessory'
import type { AccessoryInit } from './host'

/** The global maintenance switch. */
export class MaintenanceSwitch extends BaseAccessory {
  private readonly service: Service

  constructor(init: AccessoryInit) {
    super(init)
    const { Characteristic, Service: HapService } = this.host.hap
    this.service = this.requireService(HapService.Switch)
    this.service.setCharacteristic(Characteristic.Name, this.displayName)
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => {
        this.requireAvailable()
        return this.host.isMaintenanceOn()
      })
      .onSet((value: CharacteristicValue) => {
        this.requireAvailable()
        this.host.setMaintenance(value === true)
      })
  }

  protected override publishState(): void {
    this.publish(this.service, this.host.hap.Characteristic.On, this.host.isMaintenanceOn())
  }
}
