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
import { BaseAccessory } from './base-accessory';
import type { AccessoryInit } from './host';
/** PagerDuty delivery health, as a HomeKit contact sensor. */
export declare class DeliverySensor extends BaseAccessory {
    private readonly service;
    /** The state last logged, so a standing fault is reported once. */
    private lastFault;
    constructor(init: AccessoryInit);
    protected publishState(): void;
    /** "Detected" is HomeKit's word for a closed contact, the resting state. */
    private stateFor;
}
