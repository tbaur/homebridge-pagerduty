"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAccessory = void 0;
const settings_1 = require("../settings");
/** Shared behaviour for every accessory this plugin exposes. */
class BaseAccessory {
    host;
    accessory;
    displayName;
    /** See {@link AccessoryInit.unavailable}. */
    unavailable;
    /** True once the platform has torn this accessory down. */
    stopped = false;
    constructor(init) {
        this.host = init.host;
        this.accessory = init.accessory;
        this.displayName = init.displayName;
        this.unavailable = init.unavailable;
        this.configureAccessoryInformation(init);
    }
    /** Publish current state to HomeKit. Called by the platform after any change. */
    refresh() {
        if (this.stopped || this.unavailable) {
            return;
        }
        this.publishState();
    }
    /** Release anything held. After this the accessory ignores every update. */
    stop() {
        this.stopped = true;
    }
    /** Throw the HAP error that shows No Response when unavailable. */
    requireAvailable() {
        if (this.unavailable) {
            throw new this.host.api.hap.HapStatusError(-70402 /* this.host.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    /**
     * Fetch or create a service, so a restart reuses the cached one.
     *
     * Reusing the restored service is what preserves the user's room
     * assignment, custom name and automations across a restart.
     */
    requireService(type) {
        const existing = this.accessory.services.find((service) => service.UUID === type.UUID);
        return existing ?? this.accessory.addService(new type(this.displayName));
    }
    /** Publish a characteristic only when the value has actually changed. */
    publish(service, characteristic, value) {
        if (service.getCharacteristic(characteristic).value === value) {
            return;
        }
        service.updateCharacteristic(characteristic, value);
    }
    configureAccessoryInformation(init) {
        const { Characteristic, Service: HapService } = this.host.hap;
        const service = this.accessory.getService(HapService.AccessoryInformation)
            ?? this.accessory.addService(HapService.AccessoryInformation);
        service
            .setCharacteristic(Characteristic.Manufacturer, settings_1.MANUFACTURER)
            .setCharacteristic(Characteristic.Model, init.model)
            .setCharacteristic(Characteristic.SerialNumber, init.serialNumber)
            .setCharacteristic(Characteristic.FirmwareRevision, this.host.pluginVersion)
            .setCharacteristic(Characteristic.Name, this.displayName);
    }
}
exports.BaseAccessory = BaseAccessory;
