"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeliverySensor = void 0;
const base_accessory_1 = require("./base-accessory");
/** PagerDuty delivery health, as a HomeKit contact sensor. */
class DeliverySensor extends base_accessory_1.BaseAccessory {
    service;
    /** The line last logged, so a standing fault is reported once and a new cause is reported when it changes. */
    lastLine;
    constructor(init) {
        super(init);
        const { Characteristic, Service: HapService } = this.host.hap;
        this.service = this.requireService(HapService.ContactSensor);
        this.service.setCharacteristic(Characteristic.Name, this.displayName);
        this.service
            .getCharacteristic(Characteristic.ContactSensorState)
            .onGet(() => {
            this.requireAvailable();
            return this.stateFor(this.host.isDeliveryFault());
        });
    }
    publishState() {
        const fault = this.host.isDeliveryFault();
        this.publish(this.service, this.host.hap.Characteristic.ContactSensorState, this.stateFor(fault));
        const line = fault ? this.openLine() : 'pages are going out again; delivery sensor closed';
        if (!fault) {
            if (this.lastLine !== undefined && this.lastLine !== line) {
                this.host.log.info(line);
            }
            this.lastLine = line;
            return;
        }
        if (line === this.lastLine) {
            return;
        }
        this.lastLine = line;
        this.host.log.warn(line);
    }
    /** A lone rejection is one refused page. Anything else means sending has stopped. */
    openLine() {
        return this.host.deliveryFaultReport() === 'rejected'
            ? 'PagerDuty rejected a page; delivery sensor open. Other pages still send'
            : 'pages are not going out; delivery sensor open';
    }
    /** "Detected" is HomeKit's word for a closed contact, the resting state. */
    stateFor(fault) {
        const { ContactSensorState } = this.host.hap.Characteristic;
        return fault ? ContactSensorState.CONTACT_NOT_DETECTED : ContactSensorState.CONTACT_DETECTED;
    }
}
exports.DeliverySensor = DeliverySensor;
