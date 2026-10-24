/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The contract between an accessory and the platform.
 *
 * An explicit interface rather than a reference to the platform class: it
 * breaks the import cycle, and it is the whole surface an accessory may reach,
 * so a test supplies a dozen-line stand-in.
 *
 * Note what an accessory cannot do through this interface: it cannot send an
 * event or see the routing key. A write only changes desired state. Whether
 * and when anything goes to PagerDuty is decided by the reconciler, so a
 * HomeKit write never waits on PagerDuty.
 */
import type { API, HAP, PlatformAccessory } from 'homebridge';
import type { PluginLogger, Severity } from '../types';
/** Everything an accessory needs from the platform that owns it. */
export interface AccessoryHost {
    readonly api: API;
    readonly hap: HAP;
    readonly log: PluginLogger;
    /** This plugin's version, published as FirmwareRevision. */
    readonly pluginVersion: string;
    /** Whether a level switch is on. */
    isLevelOn(alertId: string, severity: Severity): boolean;
    /** A HomeKit write to a level switch. Returns once desired state is updated. */
    setLevel(alertId: string, severity: Severity, on: boolean): void;
    isMaintenanceOn(): boolean;
    setMaintenance(on: boolean): void;
    /** True when pages are not going out. */
    isDeliveryFault(): boolean;
}
/** What an accessory is handed when it is constructed. */
export interface AccessoryInit {
    host: AccessoryHost;
    accessory: PlatformAccessory;
    displayName: string;
    model: string;
    serialNumber: string;
    /**
     * True when reads must fail with No Response: the platform is disabled, or
     * this accessory belongs to an alert held for an invalid config entry.
     */
    unavailable: boolean;
}
