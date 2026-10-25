/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The platform: accessory lifecycle and wiring.
 *
 * It owns two things and delegates everything else to the controller.
 *
 * **Which accessories exist.** Configuration is validated once, expanded into
 * a list of accessories, and reconciled against what Homebridge restored from
 * its cache. Adopting a restored accessory rather than recreating it is what
 * keeps a tile attached to its room, its scenes and its automations.
 *
 * **What happens when configuration is unusable.** The platform disables
 * itself and leaves cached accessories registered, so HomeKit shows No
 * Response instead of losing the rooms built on them. Only a usable config
 * unregisters anything: an alert switch when its alert `id` is removed, and a
 * signal switch when its box is unchecked, its signal is muted, or its plugin
 * is no longer allowed.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { type AccessoryHost } from './devices';
import type { DeliveryFaultReport, Severity, SignalRef } from './types';
/** Homebridge's dynamic platform for PagerDuty alerts. */
export declare class PagerDutyPlatform implements DynamicPlatformPlugin, AccessoryHost {
    readonly api: API;
    readonly log: Logging;
    readonly pluginVersion: string;
    private readonly restored;
    private readonly handlers;
    private readonly diagnostics;
    private controller;
    private schemaWriter;
    private config;
    private diagnosticsTimer;
    private lastDiagnosticsHealth;
    constructor(log: Logging, platformConfig: PlatformConfig, api: API);
    get hap(): API['hap'];
    /** Homebridge hands back every accessory it restored from its cache. */
    configureAccessory(accessory: PlatformAccessory): void;
    private start;
    /** Keep the Plugin Signals section of the settings screen in line with the signal store. */
    private startSettingsScreen;
    private stop;
    /** Keep cached accessories registered, answering No Response. */
    private keepRestoredUnavailable;
    /**
     * Bring the registered accessory set in line with configuration.
     *
     * Accessories of a held alert are neither adopted nor removed: they stay
     * registered and answer No Response until the entry is fixed.
     *
     * Returns which accessories were created and which were renamed, for the
     * startup report.
     */
    private syncAccessories;
    /** Returns the previous name when the accessory had to be renamed. */
    private adopt;
    /** Attach a handler to a cached accessory without touching its identity. */
    private revive;
    private attachHandler;
    /** Seeded from the identity key alone: alert id plus severity, never a name. */
    private uuidFor;
    private refreshAll;
    isLevelOn(alertId: string, severity: Severity): boolean;
    setLevel(alertId: string, severity: Severity, on: boolean): void;
    isSignalSwitchOn(signal: SignalRef): boolean;
    setSignalSwitch(signal: SignalRef, on: boolean): void;
    isMaintenanceOn(): boolean;
    setMaintenance(on: boolean): void;
    isDeliveryFault(): boolean;
    deliveryFaultReport(): DeliveryFaultReport;
    private gauges;
    private startDiagnostics;
    private stopDiagnostics;
    private diagnosticsHeartbeat;
    private emitDiagnostic;
}
