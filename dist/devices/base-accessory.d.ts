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
import type { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import type { AccessoryHost, AccessoryInit } from './host';
/** A concrete HAP service class, such as `Service.Switch`. */
export type ServiceConstructor = {
    UUID: string;
    new (displayName?: string, subtype?: string): Service;
};
/** A concrete HAP characteristic class, such as `Characteristic.On`. */
export type CharacteristicConstructor = WithUUID<new () => Characteristic>;
/** Shared behaviour for every accessory this plugin exposes. */
export declare abstract class BaseAccessory {
    protected readonly host: AccessoryHost;
    protected readonly accessory: PlatformAccessory;
    readonly displayName: string;
    /** See {@link AccessoryInit.unavailable}. */
    protected readonly unavailable: boolean;
    /** True once the platform has torn this accessory down. */
    private stopped;
    constructor(init: AccessoryInit);
    /** Publish current state to HomeKit. Called by the platform after any change. */
    refresh(): void;
    /** Release anything held. After this the accessory ignores every update. */
    stop(): void;
    /** Throw the HAP error that shows No Response when unavailable. */
    protected requireAvailable(): void;
    /**
     * Fetch or create a service, so a restart reuses the cached one.
     *
     * Reusing the restored service is what preserves the user's room
     * assignment, custom name and automations across a restart.
     */
    protected requireService(type: ServiceConstructor): Service;
    /** Publish a characteristic only when the value has actually changed. */
    protected publish(service: Service, characteristic: CharacteristicConstructor, value: CharacteristicValue): void;
    /** Push current state into this accessory's characteristics. */
    protected abstract publishState(): void;
    private configureAccessoryInformation;
}
