"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Naming plugins that still write to a retired signal store.
 *
 * A retired store is one that an earlier version of this plugin read. It is
 * opened read-only and only plugin names are read from it, so a writer that
 * was never updated is named in the log but can never page. `node:sqlite` is
 * loaded only when a retired store exists.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RETIRED_WRITERS = void 0;
exports.findRetiredStoreWriters = findRetiredStoreWriters;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_1 = require("../settings");
const errors_1 = require("../utils/errors");
const schema_1 = require("./schema");
/** Most plugin names read from one retired store. */
exports.MAX_RETIRED_WRITERS = 20;
/**
 * The plugins with rows in each retired store that exists. A store that cannot
 * be read is skipped with a `debug` line: this is advice, never a fault.
 */
function findRetiredStoreWriters(input) {
    const found = [];
    for (const store of input.stores) {
        const path = (0, node_path_1.join)(input.storageDir, store);
        if (!(0, node_fs_1.existsSync)(path)) {
            continue;
        }
        try {
            const sqlite = (input.loadSqlite ?? loadNodeSqlite)();
            const plugins = readPluginNames(new sqlite.DatabaseSync(path, { readOnly: true }));
            if (plugins.length > 0) {
                found.push({ store, plugins });
            }
        }
        catch (error) {
            input.log.debug(`retired signal store ${store} was not read: ${(0, errors_1.describeError)(error)}`);
        }
    }
    return found;
}
function readPluginNames(db) {
    try {
        db.exec(`PRAGMA busy_timeout = ${settings_1.READER_BUSY_TIMEOUT_MS}`);
        const rows = db.prepare(`SELECT DISTINCT plugin FROM signals ORDER BY plugin LIMIT ${exports.MAX_RETIRED_WRITERS}`).all();
        return rows
            .map((row) => row.plugin)
            .filter((plugin) => (0, schema_1.isValidPluginName)(plugin) && plugin !== settings_1.PLUGIN_NAME);
    }
    finally {
        db.close();
    }
}
function loadNodeSqlite() {
    return process.getBuiltinModule('node:sqlite');
}
