/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview What every accessory in this plugin has in common.
 * State here is local, so a read always has an answer and a write never waits
 * on the network.
 *
 * Two rules are enforced here rather than trusted to each subclass.
 *
 * **Unavailable means No Response.** When the platform is disabled, or the
 * alert is held for an invalid config entry, a read throws
 * `SERVICE_COMMUNICATION_FAILURE` and a write is refused. Showing a remembered
 * value would let an automation believe a switch it cannot use.
 *
 * **Keep identity stable.** Accessory information is written once here, from
 * values the platform resolved, so no subclass can key an accessory on
 * something that changes and take a user's rooms and automations with it.
 */

import type { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge'

import { MANUFACTURER } from '../settings'
import type { AccessoryHost, AccessoryInit } from './host'

/** A concrete HAP service class, such as `Service.Switch`. */
export type ServiceConstructor = {
  UUID: string
  new (displayName?: string, subtype?: string): Service
}

/** A concrete HAP characteristic class, such as `Characteristic.On`. */
export type CharacteristicConstructor = WithUUID<new () => Characteristic>

/** Shared behaviour for every accessory this plugin exposes. */
export abstract class BaseAccessory {
  protected readonly host: AccessoryHost

  protected readonly accessory: PlatformAccessory

  readonly displayName: string

  /** See {@link AccessoryInit.unavailable}. */
  protected readonly unavailable: boolean

  /** True once the platform has torn this accessory down. */
  private stopped = false

  constructor(init: AccessoryInit) {
    this.host = init.host
    this.accessory = init.accessory
    this.displayName = init.displayName
    this.unavailable = init.unavailable
    this.configureAccessoryInformation(init)
  }

  /** Publish current state to HomeKit. Called by the platform after any change. */
  refresh(): void {
    if (this.stopped || this.unavailable) {
      return
    }
    this.publishState()
  }

  /** Release anything held. After this the accessory ignores every update. */
  stop(): void {
    this.stopped = true
  }

  /** Throw the HAP error that shows No Response when unavailable. */
  protected requireAvailable(): void {
    if (this.unavailable) {
      throw new this.host.api.hap.HapStatusError(this.host.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  /**
   * Fetch or create a service, so a restart reuses the cached one.
   *
   * Reusing the restored service is what preserves the user's room
   * assignment, custom name and automations across a restart.
   */
  protected requireService(type: ServiceConstructor): Service {
    const existing = this.accessory.services.find((service) => service.UUID === type.UUID)
    return existing ?? this.accessory.addService(new type(this.displayName))
  }

  /** Publish a characteristic only when the value has actually changed. */
  protected publish(service: Service, characteristic: CharacteristicConstructor, value: CharacteristicValue): void {
    if (service.getCharacteristic(characteristic).value === value) {
      return
    }
    service.updateCharacteristic(characteristic, value)
  }

  /** Push current state into this accessory's characteristics. */
  protected abstract publishState(): void

  private configureAccessoryInformation(init: AccessoryInit): void {
    const { Characteristic, Service: HapService } = this.host.hap
    const service = this.accessory.getService(HapService.AccessoryInformation)
      ?? this.accessory.addService(HapService.AccessoryInformation)
    service
      .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, init.model)
      .setCharacteristic(Characteristic.SerialNumber, init.serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, this.host.pluginVersion)
      .setCharacteristic(Characteristic.Name, this.displayName)
  }
}
