"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalReader = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_1 = require("../settings");
const errors_1 = require("../utils/errors");
const schema_1 = require("./schema");
function loadNodeSqlite() {
    return process.getBuiltinModule('node:sqlite');
}
/** Polls `homebridge-pagerduty/signals.sqlite` for allowlisted rows. */
class SignalReader {
    options;
    connection;
    sqlite;
    hasWarnedVersion = false;
    constructor(options) {
        this.options = options;
    }
    /**
     * Create the store if needed and open it, so writers usually find it ready.
     *
     * The file is created with owner-only mode before SQLite touches it, because
     * SQLite gives the `-wal` and `-shm` files the main file's mode.
     */
    create() {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.options.path), { recursive: true, mode: settings_1.PRIVATE_DIR_MODE });
        (0, node_fs_1.closeSync)((0, node_fs_1.openSync)(this.options.path, 'a', settings_1.PRIVATE_FILE_MODE));
        this.reopen();
    }
    /** Read the allowlisted rows if anything changed since the last poll. */
    poll() {
        let stats;
        try {
            stats = (0, node_fs_1.statSync)(this.options.path);
        }
        catch (error) {
            this.close();
            return { kind: 'unavailable', reason: (0, errors_1.errorCode)(error) === 'ENOENT' ? 'missing' : (0, errors_1.describeError)(error) };
        }
        try {
            if (this.connection === undefined || this.connection.dev !== stats.dev || this.connection.ino !== stats.ino) {
                this.reopen();
            }
            return this.read(this.requireConnection());
        }
        catch (error) {
            if (!isBusy(error)) {
                this.close();
            }
            return { kind: 'unavailable', reason: isBusy(error) ? 'busy' : (0, errors_1.describeError)(error) };
        }
    }
    /** Close the connection. Safe to call twice. */
    close() {
        const connection = this.connection;
        this.connection = undefined;
        try {
            connection?.db.close();
        }
        catch (error) {
            this.options.log.debug(`signal store close failed: ${(0, errors_1.describeError)(error)}`);
        }
    }
    requireConnection() {
        if (this.connection === undefined) {
            throw new Error('signal store is not open');
        }
        return this.connection;
    }
    reopen() {
        this.close();
        this.sqlite ??= (this.options.loadSqlite ?? loadNodeSqlite)();
        const db = new this.sqlite.DatabaseSync(this.options.path);
        try {
            // Set explicitly: the constructor's `timeout` option only exists from
            // Node 22.16, and the floor is 22.13.
            db.exec(`PRAGMA busy_timeout = ${settings_1.READER_BUSY_TIMEOUT_MS}`);
            db.exec(schema_1.SIGNAL_SCHEMA_SQL);
            this.checkVersion(db);
            this.tightenModes();
            const placeholders = this.options.allowed.map(() => '?').join(', ');
            const stats = (0, node_fs_1.statSync)(this.options.path);
            this.connection = {
                db,
                dev: stats.dev,
                ino: stats.ino,
                rows: this.options.allowed.length === 0 ? undefined : db.prepare('SELECT plugin, signal, active, severity, summary, updated_at FROM signals '
                    + `WHERE plugin IN (${placeholders}) ORDER BY updated_at DESC LIMIT ${settings_1.MAX_SIGNAL_ROWS + 1}`),
                catalog: db.prepare('SELECT plugin, signal, summary FROM signals WHERE plugin <> ? '
                    + `ORDER BY plugin, signal LIMIT ${settings_1.MAX_CATALOG_SCAN_ROWS}`),
                dataVersion: db.prepare('PRAGMA data_version'),
                lastDataVersion: undefined,
            };
        }
        catch (error) {
            db.close();
            throw error;
        }
    }
    read(connection) {
        const version = Number(connection.dataVersion.get()?.data_version);
        if (connection.lastDataVersion !== undefined && version === connection.lastDataVersion) {
            return { kind: 'unchanged' };
        }
        const raw = (connection.rows?.all(...this.options.allowed) ?? []);
        const rows = [];
        let invalidRows = 0;
        for (const entry of raw.slice(0, settings_1.MAX_SIGNAL_ROWS)) {
            const row = (0, schema_1.validateRow)(entry);
            if (row === undefined) {
                invalidRows += 1;
            }
            else {
                rows.push(row);
            }
        }
        const catalog = connection.catalog.all(settings_1.PLUGIN_NAME)
            .map(schema_1.validateCatalogEntry)
            .filter((entry) => entry !== undefined)
            .slice(0, settings_1.MAX_CATALOG_ROWS);
        connection.lastDataVersion = version;
        return { kind: 'rows', rows, complete: raw.length <= settings_1.MAX_SIGNAL_ROWS, catalog, invalidRows };
    }
    checkVersion(db) {
        const row = db.prepare('PRAGMA user_version').get();
        const version = Number(row?.user_version ?? 0);
        if (version === 0) {
            db.exec(`PRAGMA user_version = ${schema_1.SIGNAL_SCHEMA_VERSION}`);
        }
        else if (version > schema_1.SIGNAL_SCHEMA_VERSION && !this.hasWarnedVersion) {
            this.hasWarnedVersion = true;
            this.options.log.warn(`signal store is interface version ${version}; this plugin reads version ${schema_1.SIGNAL_SCHEMA_VERSION}. Update homebridge-pagerduty`);
        }
    }
    /** Owner-only on POSIX systems, for the main file and SQLite's two side files. */
    tightenModes() {
        if ((this.options.platform ?? process.platform) === 'win32') {
            return;
        }
        for (const file of [this.options.path, `${this.options.path}-wal`, `${this.options.path}-shm`]) {
            try {
                if (((0, node_fs_1.statSync)(file).mode & 0o077) !== 0) {
                    (0, node_fs_1.chmodSync)(file, settings_1.PRIVATE_FILE_MODE);
                    this.options.log.info(`tightened ${file} to owner-only`);
                }
            }
            catch {
                // The side files exist only while a connection is open.
            }
        }
    }
}
exports.SignalReader = SignalReader;
function isBusy(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.errcode;
    return code === 5 || code === 6 || /database is (?:locked|busy)/i.test(message);
}
