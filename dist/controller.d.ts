/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The alert controller: state, persistence, timers, the signal
 * poll and the sender, wired together.
 *
 * Every rule lives elsewhere: in `state/mutations.ts` (what a change does),
 * `state/desired.ts` and `state/reconcile.ts` (what must be sent), and
 * `delivery/sender.ts` (how). This file decides *when* each runs, persists the
 * result, and tells the platform that HomeKit should be refreshed.
 */
import { type JsonPost } from './delivery/http';
import { type PollResult } from './signals/reader';
import { StateStore } from './state/store';
import type { CatalogEntry, DeliveryFaultReport, DeliveryGauges, PluginLogger, ResolvedConfig, Severity, SignalRef } from './types';
import type { InterruptibleSleep } from './utils/timing';
/** The reader surface the controller uses. A stand-in in tests. */
export interface SignalReaderLike {
    create(): void;
    poll(): PollResult;
    close(): void;
}
/** Construction options for {@link AlertController}. */
export interface ControllerOptions {
    config: ResolvedConfig;
    log: PluginLogger;
    /** The Homebridge storage directory. Files go in its {@link DATA_DIR_NAME} subdirectory. */
    storageDir: string;
    pluginVersion: string;
    post?: JsonPost;
    now?: () => number;
    random?: () => number;
    sleep?: (ms: number) => InterruptibleSleep;
    store?: StateStore;
    createReader?: (path: string, allowed: readonly string[]) => SignalReaderLike;
    onRequest?: (durationMs: number, ok: boolean) => void;
}
/** Owns desired and delivered state and keeps PagerDuty in line with it. */
export declare class AlertController {
    private readonly options;
    private readonly config;
    private readonly log;
    private readonly now;
    private readonly store;
    private readonly sender;
    private readonly health;
    private readonly alertsById;
    private readonly allowed;
    /** Signals with a switch, by `<plugin>/<signal>`. */
    private readonly switches;
    private readonly listeners;
    private readonly catalogListeners;
    private readonly abort;
    private readonly knownForeignWriters;
    private readonly outageGapKeys;
    private state;
    private plan;
    private fault;
    private faultReport;
    private reader;
    private storeUnreadableSince;
    private catalog;
    private catalogNames;
    private lastStoreWarnAt;
    private pendingRowSweep;
    private started;
    private stopped;
    private readonly timers;
    constructor(options: ControllerOptions);
    /**
     * Load state and start delivering.
     *
     * Throws `StateUnreadableError` when the state directory cannot be created
     * or the state file exists but cannot be read; the platform then disables
     * itself.
     */
    start(): void;
    /** Stop timers and the sender, close the store, and finish writing state. */
    stop(): Promise<void>;
    /** Called after any change HomeKit should see. */
    onChange(listener: () => void): void;
    isLevelOn(alertId: string, severity: Severity): boolean;
    /** A switch write. Updates desired state, persists it, wakes the sender and returns. */
    setLevel(alertId: string, severity: Severity, on: boolean): void;
    isMaintenanceOn(): boolean;
    setMaintenance(on: boolean): void;
    isSignalSwitchOn(ref: SignalRef): boolean;
    /** A signal switch write. Pages or resolves with the signal's settings. */
    setSignalSwitch(ref: SignalRef, on: boolean): void;
    isDeliveryFault(): boolean;
    /** `rejected` when the only problem is a refused event. */
    deliveryFaultReport(): DeliveryFaultReport;
    /** Live counts for diagnostics. */
    gauges(): DeliveryGauges;
    private kick;
    private reconcileNow;
    /** A rejection stops counting once the desired state no longer matches it. */
    private pruneRejections;
    private post;
    /** Record what was *sent*, never the desired state at the moment the answer arrives. */
    private recordDelivered;
    private recordRejected;
    /** Alerts that had an unsent trigger during the outage and are now closed with nothing delivered. */
    private countSuperseded;
    private handleDeadlines;
    private scheduleDeadline;
    private updateFault;
    private notify;
    /**
     * The store is polled even when no plugin is allowed, because the settings
     * screen lists every plugin that writes to it. It is created only when a
     * plugin is allowed, and a missing or broken store is a fault only then.
     */
    private startSignals;
    /**
     * Every plugin's signals at the last read, for the settings screen and the
     * startup report. Undefined when the store has not been read. A store that
     * does not exist yet reads as empty. The text is the other plugin's and is
     * untrusted.
     */
    signalCatalog(): readonly CatalogEntry[] | undefined;
    /** Called when a plugin or signal appears in the store or leaves it. */
    onCatalogChange(listener: () => void): void;
    private pollSignals;
    private updateCatalog;
    private applySignalRows;
    private noteStoreUnavailable;
    private noteStoreAvailable;
    private warnAboutKeyChange;
    /**
     * After a corrupt state file, mark every alert that is desired closed as
     * possibly open, so the reconciler sends it a resolve. A resolve with no
     * open alert is dropped by PagerDuty with a `202`, so this is safe.
     */
    private sweepClosedAlerts;
    /** The same sweep for signals, once the first read says which exist. */
    private sweepClosedRows;
    /** Drop switch and timer state for alerts removed from config. Their delivered records stay, so they are resolved. */
    private forgetRemovedAlerts;
    private labelFor;
    /**
     * Keep a corrupt-file sweep's delivered records on a dry-run save.
     *
     * The unreadable file has already been moved aside. Without this, the dry
     * run would write an empty delivered map and the next real start would
     * never send those resolves.
     */
    private retainSweep;
    private persist;
    private requireState;
}
