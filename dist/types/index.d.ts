/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared types for configuration, accessory identity, signals
 * and diagnostics.
 */
/** The subset of Homebridge's logger this plugin uses. */
export interface PluginLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}
/**
 * PagerDuty severities, lowest first. Case-sensitive on the wire.
 *
 * The order is load-bearing: an alert's severity is the highest of its levels
 * that are on, and PagerDuty never lowers an alert, so neither does the plugin.
 */
export declare const SEVERITIES: readonly ["info", "warning", "error", "critical"];
/** @see SEVERITIES */
export type Severity = (typeof SEVERITIES)[number];
/** Narrow an unknown value to a {@link Severity}. */
export declare function isSeverity(value: unknown): value is Severity;
/** Position in {@link SEVERITIES}; higher is more severe. */
export declare function severityRank(severity: Severity): number;
/** Events API region. Decides the endpoint host and nothing else. */
export type Region = 'us' | 'eu';
/** A `<plugin>/<signal>` reference to one row of the signal store. */
export interface SignalRef {
    plugin: string;
    signal: string;
}
/** One `alerts[].levels[]` entry, as written in `config.json`. */
export interface LevelConfig {
    severity?: unknown;
    name?: unknown;
}
/** One `alerts[]` entry, as written in `config.json`. */
export interface AlertConfig {
    id?: unknown;
    name?: unknown;
    summary?: unknown;
    levels?: unknown;
    resolveAfterMinutes?: unknown;
    bypassMaintenance?: unknown;
    signal?: unknown;
}
/** Shape of one `platforms[]` entry in `config.json`. */
export interface PagerDutyPlatformConfig {
    platform: string;
    name?: string;
    /** The integration key. Never logged: not its value, its length or a prefix. */
    routingKey?: unknown;
    region?: unknown;
    source?: unknown;
    alerts?: unknown;
    maintenance?: {
        switch?: unknown;
        name?: unknown;
        maxMinutes?: unknown;
    };
    signals?: {
        sources?: unknown;
    };
    options?: {
        deliveryFaultSensor?: unknown;
        deliveryFaultSensorName?: unknown;
        dryRun?: unknown;
        diagnosticsInterval?: unknown;
        structuredLogs?: unknown;
    };
}
/** A level after validation. */
export interface ResolvedLevel {
    severity: Severity;
    name: string;
}
/** An alert after validation and defaulting. */
export interface ResolvedAlert {
    id: string;
    name: string;
    summary: string;
    levels: ResolvedLevel[];
    resolveAfterMinutes: number;
    bypassMaintenance: boolean;
    /** Present when the alert mirrors a signal row. Such an alert has one level. */
    signal?: SignalRef;
}
/** Platform-wide options after validation and defaulting. */
export interface ResolvedOptions {
    deliveryFaultSensor: boolean;
    deliveryFaultSensorName: string;
    dryRun: boolean;
    diagnosticsInterval: number;
    structuredLogs: boolean;
}
/** A usable configuration. */
export interface ResolvedConfig {
    routingKey: string;
    region: Region;
    source: string;
    alerts: ResolvedAlert[];
    /**
     * Alerts whose entry failed validation but whose `id` is still readable.
     *
     * Their state, delivered record and accessories are kept exactly as they
     * were and nothing is sent for them. Without this, a typo in a summary
     * would resolve a live incident and delete the tile and its automations.
     */
    heldAlertIds: string[];
    maintenance: {
        switch: boolean;
        name: string;
        maxMinutes: number;
    };
    signalSources: string[];
    options: ResolvedOptions;
}
/** What an accessory is. Part of its identity, and therefore of its UUID. */
export declare const ACCESSORY_KINDS: readonly ["alert", "maintenance", "delivery"];
/** @see ACCESSORY_KINDS */
export type AccessoryKind = (typeof ACCESSORY_KINDS)[number];
/** Narrow an unknown value to an {@link AccessoryKind}. */
export declare function isAccessoryKind(value: unknown): value is AccessoryKind;
/** One accessory to expose, derived from configuration. */
export interface ResolvedAccessory {
    kind: AccessoryKind;
    /** HomeKit display name. Never part of identity. */
    name: string;
    alertId?: string;
    severity?: Severity;
}
/**
 * What gets persisted in `PlatformAccessory.context`.
 *
 * Note what is absent: no routing key. The accessory cache is a plain JSON
 * file and is included in the diagnostic bundles users attach to issues.
 */
export interface AccessoryContext {
    kind: AccessoryKind;
    alertId?: string;
    severity?: Severity;
    /** Opaque, stable, generated once. */
    serialNumber: string;
}
/** One validated row from the signal store. */
export interface SignalRow extends SignalRef {
    active: boolean;
    severity: Severity;
    summary: string;
    updatedAt: number;
}
/** Live gauges the diagnostics collector reads. */
export interface DeliveryGauges {
    openAlerts: number;
    pending: number;
    heldByMaintenance: number;
    rejected: number;
    deliveryFault: boolean;
    /** Null when the signal store is not in use. */
    storeOk: boolean | null;
    outage: boolean;
}
/** One opt-in diagnostics report. */
export interface DiagnosticsSnapshot {
    msg: string;
    lifecycle: {
        health: 'healthy' | 'degraded';
        reasons: string[];
        uptimeSec: number;
        pluginVersion: string;
    };
    delivery: DeliveryGauges;
    api: {
        p50Ms: number;
        p95Ms: number;
        requests: number;
        errors: number;
    };
    /** Redacted config echo, present only on start and stop snapshots. */
    config?: Record<string, unknown>;
}
