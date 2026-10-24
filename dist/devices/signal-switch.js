"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalSwitch = void 0;
const base_accessory_1 = require("./base-accessory");
/** One signal's switch. */
class SignalSwitch extends base_accessory_1.BaseAccessory {
    service;
    signal;
    constructor(init) {
        super(init);
        this.signal = init.signal;
        const { Characteristic, Service: HapService } = this.host.hap;
        this.service = this.requireService(HapService.Switch);
        this.service.setCharacteristic(Characteristic.Name, this.displayName);
        this.service
            .getCharacteristic(Characteristic.On)
            .onGet(() => {
            this.requireAvailable();
            return this.host.isSignalSwitchOn(this.signal);
        })
            .onSet((value) => {
            this.requireAvailable();
            this.host.setSignalSwitch(this.signal, value === true);
        });
    }
    publishState() {
        this.publish(this.service, this.host.hap.Characteristic.On, this.host.isSignalSwitchOn(this.signal));
    }
}
exports.SignalSwitch = SignalSwitch;
