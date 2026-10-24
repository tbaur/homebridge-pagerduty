/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Loading and saving the state file.
 *
 * Starting empty is a kind of clear, and a read error is never a clear. So the
 * three ways a load can go are handled differently:
 *
 * - `ENOENT`: first run. Start empty.
 * - Unparseable, or a shape this version does not know: rename the file aside
 *   and start empty. The caller then resolves every key that is desired closed,
 *   so nothing the lost file knew about is left open in PagerDuty.
 * - Any other read error (`EACCES`, `EIO`), or a directory that cannot be
 *   created: throw. The platform disables itself, because starting empty would
 *   hide whatever is wrong with the disk.
 */
import type { PluginLogger } from '../types';
import type { PersistedState } from './model';
/** Outcome of {@link StateStore.load}. */
export interface LoadResult {
    state: PersistedState;
    outcome: 'fresh' | 'loaded' | 'corrupt';
}
/** Construction options for {@link StateStore}. */
export interface StateStoreOptions {
    path: string;
    log: PluginLogger;
    /**
     * False in `dryRun`: delivered and rejected records stay in memory, and the
     * file keeps the ones it was loaded with, so a dry run never convinces a
     * later real run that something was delivered.
     */
    persistDelivery: boolean;
    now?: () => number;
    write?: (path: string, value: unknown, mode: number) => Promise<void>;
}
/** SHA-256 of the routing key. The only form of the key that is ever persisted. */
export declare function fingerprintRoutingKey(routingKey: string): string;
/** Reads and writes `homebridge-pagerduty/state.json`. */
export declare class StateStore {
    private readonly options;
    private readonly now;
    private readonly write;
    private chain;
    private diskDelivery;
    constructor(options: StateStoreOptions);
    /** Load the state file. Throws {@link StateUnreadableError}; see the file header. */
    load(): LoadResult;
    /**
     * Persist a snapshot. Writes are serialized, so the file always ends up
     * holding the most recent one. Never rejects: a failed write is logged, and
     * the next change writes the whole state again.
     */
    save(state: PersistedState): Promise<void>;
    /** Resolves once every queued write has finished. */
    flush(): Promise<void>;
    private moveAside;
}
/**
 * Parse the state file strictly.
 *
 * One malformed record makes the whole file corrupt. Dropping just that record
 * would quietly forget an open alert; treating the file as corrupt instead
 * triggers the resolve sweep, which is safe.
 */
export declare function parseState(raw: string): PersistedState | undefined;
