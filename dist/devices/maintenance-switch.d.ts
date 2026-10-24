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
import { BaseAccessory } from './base-accessory';
import type { AccessoryInit } from './host';
/** The global maintenance switch. */
export declare class MaintenanceSwitch extends BaseAccessory {
    private readonly service;
    constructor(init: AccessoryInit);
    protected publishState(): void;
}
