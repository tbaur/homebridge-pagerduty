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
import type { SignalRef } from '../types';
import { BaseAccessory } from './base-accessory';
import type { AccessoryInit } from './host';
/** One signal's switch. */
export declare class SignalSwitch extends BaseAccessory {
    private readonly service;
    readonly signal: SignalRef;
    constructor(init: AccessoryInit & {
        signal: SignalRef;
    });
    protected publishState(): void;
}
