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
import type { DeliveryGauges, PluginLogger, ResolvedConfig, Severity } from './types';
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
    createReader?: (path: string, sources: readonly string[]) => SignalReaderLike;
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
    private readonly boundAlerts;
    private readonly listeners;
    private readonly abort;
    private readonly knownForeignWriters;
    private readonly outageGapKeys;
    private state;
    private plan;
    private fault;
    private reader;
    private storeUnreadableSince;
    private writtenSignals;
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
    isDeliveryFault(): boolean;
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
    private startSignals;
    /**
     * The signal names each listed plugin had written at the last read, or
     * undefined when the store has not been read. A store that does not exist
     * yet reads as empty.
     */
    signalsWritten(): ReadonlyMap<string, readonly string[]> | undefined;
    private pollSignals;
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
    /** The same sweep for unbound rows, once the first read says which exist. */
    private sweepClosedRows;
    /** Drop switch and timer state for alerts removed from config. Their delivered records stay, so they are resolved. */
    private forgetRemovedAlerts;
    private labelFor;
    private persist;
    private requireState;
}
