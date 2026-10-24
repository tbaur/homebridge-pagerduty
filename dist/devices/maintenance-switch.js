"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceSwitch = void 0;
const base_accessory_1 = require("./base-accessory");
/** The global maintenance switch. */
class MaintenanceSwitch extends base_accessory_1.BaseAccessory {
    service;
    constructor(init) {
        super(init);
        const { Characteristic, Service: HapService } = this.host.hap;
        this.service = this.requireService(HapService.Switch);
        this.service.setCharacteristic(Characteristic.Name, this.displayName);
        this.service
            .getCharacteristic(Characteristic.On)
            .onGet(() => {
            this.requireAvailable();
            return this.host.isMaintenanceOn();
        })
            .onSet((value) => {
            this.requireAvailable();
            this.host.setMaintenance(value === true);
        });
    }
    publishState() {
        this.publish(this.service, this.host.hap.Characteristic.On, this.host.isMaintenanceOn());
    }
}
exports.MaintenanceSwitch = MaintenanceSwitch;
