/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Reading the signal store.
 *
 * `node:sqlite` is loaded only once the store file exists, so a user with no
 * plugin that writes signals never loads it (or sees its ExperimentalWarning on
 * Node 22). `DatabaseSync` is synchronous, so every call here blocks the bridge
 * process; the busy timeout is short and a busy store skips the poll.
 *
 * Rules this file enforces:
 * - The allowlist is applied in the query, so rows from other writers can never
 *   push allowed rows past the read cap.
 * - Rows from plugins that are not allowed are read only as names and text for
 *   the settings screen, never as signals.
 * - A read error is never a clear. Missing, busy and corrupt all report
 *   `unavailable`, and the caller keeps the last rows it saw.
 * - Each poll `stat`s the file. A new device or inode number means the file was
 *   replaced, and an old connection would keep reading the deleted one.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { CatalogEntry, PluginLogger, SignalRow } from '../types';
/** The part of `node:sqlite` this file uses. */
export interface SqliteModule {
    DatabaseSync: new (path: string) => DatabaseSync;
}
/** Outcome of one poll. */
export type PollResult = {
    kind: 'unchanged';
} | {
    kind: 'rows';
    rows: SignalRow[];
    complete: boolean;
    catalog: CatalogEntry[];
    invalidRows: number;
} | {
    kind: 'unavailable';
    reason: string;
};
/** Construction options for {@link SignalReader}. */
export interface SignalReaderOptions {
    path: string;
    /** Plugins whose rows are read as signals. */
    allowed: readonly string[];
    log: PluginLogger;
    loadSqlite?: () => SqliteModule;
    platform?: typeof process.platform;
}
/** Polls `homebridge-pagerduty/signals.sqlite` for allowlisted rows. */
export declare class SignalReader {
    private readonly options;
    private connection;
    private sqlite;
    private hasWarnedVersion;
    constructor(options: SignalReaderOptions);
    /**
     * Create the store if needed and open it, so writers usually find it ready.
     *
     * The file is created with owner-only mode before SQLite touches it, because
     * SQLite gives the `-wal` and `-shm` files the main file's mode.
     */
    create(): void;
    /** Read the allowlisted rows if anything changed since the last poll. */
    poll(): PollResult;
    /** Close the connection. Safe to call twice. */
    close(): void;
    private requireConnection;
    private reopen;
    private read;
    private checkVersion;
    /** Owner-only on POSIX systems, for the main file and SQLite's two side files. */
    private tightenModes;
}
