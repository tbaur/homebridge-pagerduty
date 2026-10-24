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
import type { Severity } from '../types';
import { BaseAccessory } from './base-accessory';
import type { AccessoryInit } from './host';
/** One level switch. */
export declare class AlertSwitch extends BaseAccessory {
    private readonly service;
    readonly alertId: string;
    readonly severity: Severity;
    constructor(init: AccessoryInit & {
        alertId: string;
        severity: Severity;
    });
    private readOn;
    private writeOn;
    protected publishState(): void;
}
