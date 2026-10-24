"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateStore = void 0;
exports.fingerprintRoutingKey = fingerprintRoutingKey;
exports.parseState = parseState;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_1 = require("../settings");
const types_1 = require("../types");
const atomic_file_1 = require("../utils/atomic-file");
const errors_1 = require("../utils/errors");
const model_1 = require("./model");
/** SHA-256 of the routing key. The only form of the key that is ever persisted. */
function fingerprintRoutingKey(routingKey) {
    return (0, node_crypto_1.createHash)('sha256').update(routingKey).digest('hex');
}
/** Reads and writes `homebridge-pagerduty/state.json`. */
class StateStore {
    options;
    now;
    write;
    chain = Promise.resolve();
    diskDelivery = { delivered: {}, rejected: {} };
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.write = options.write ?? atomic_file_1.writeJsonAtomic;
    }
    /** Load the state file. Throws {@link StateUnreadableError}; see the file header. */
    load() {
        try {
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.options.path), { recursive: true, mode: settings_1.PRIVATE_DIR_MODE });
        }
        catch (error) {
            throw new errors_1.StateUnreadableError('state directory could not be created', { cause: error });
        }
        let raw;
        try {
            raw = (0, node_fs_1.readFileSync)(this.options.path, 'utf8');
        }
        catch (error) {
            if ((0, errors_1.errorCode)(error) === 'ENOENT') {
                return { state: (0, model_1.emptyState)(), outcome: 'fresh' };
            }
            throw new errors_1.StateUnreadableError('state file could not be read', { cause: error });
        }
        const state = parseState(raw);
        if (state === undefined) {
            this.moveAside();
            return { state: (0, model_1.emptyState)(), outcome: 'corrupt' };
        }
        this.diskDelivery = { delivered: { ...state.delivered }, rejected: { ...state.rejected } };
        return { state, outcome: 'loaded' };
    }
    /**
     * Persist a snapshot. Writes are serialized, so the file always ends up
     * holding the most recent one. Never rejects: a failed write is logged, and
     * the next change writes the whole state again.
     */
    save(state) {
        const snapshot = this.options.persistDelivery
            ? structuredClone(state)
            : { ...structuredClone(state), ...structuredClone(this.diskDelivery) };
        this.chain = this.chain
            .then(() => this.write(this.options.path, snapshot, settings_1.PRIVATE_FILE_MODE))
            .catch((error) => {
            this.options.log.error(`state file could not be written: ${(0, errors_1.describeError)(error)}`);
        });
        return this.chain;
    }
    /** Resolves once every queued write has finished. */
    flush() {
        return this.chain;
    }
    moveAside() {
        const aside = `${this.options.path}.corrupt-${this.now()}`;
        try {
            (0, node_fs_1.renameSync)(this.options.path, aside);
            this.options.log.warn(`state file was unreadable; moved aside and starting empty: ${aside}`);
        }
        catch (error) {
            this.options.log.warn(`state file was unreadable and could not be moved aside (${(0, errors_1.describeError)(error)}); starting empty`);
        }
    }
}
exports.StateStore = StateStore;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isTime(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isTimeOrNull(value) {
    return value === null || isTime(value);
}
function everyValue(value, check) {
    return isRecord(value) && Object.values(value).every((entry) => isRecord(entry) && check(entry));
}
/**
 * Parse the state file strictly.
 *
 * One malformed record makes the whole file corrupt. Dropping just that record
 * would quietly forget an open alert; treating the file as corrupt instead
 * triggers the resolve sweep, which is safe.
 */
function parseState(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.version !== model_1.STATE_VERSION) {
        return undefined;
    }
    // Files written before signal switches existed have no `switches`.
    parsed.switches ??= {};
    const { routingKeyFingerprint: fingerprint, maintenance } = parsed;
    const isLevelState = (entry) => typeof entry.on === 'boolean' && isTime(entry.changedAt);
    const valid = (fingerprint === null || typeof fingerprint === 'string')
        && isRecord(maintenance)
        && typeof maintenance.on === 'boolean'
        && isTimeOrNull(maintenance.since)
        && isTimeOrNull(maintenance.until)
        && everyValue(parsed.levels, isLevelState)
        && everyValue(parsed.switches, isLevelState)
        && everyValue(parsed.alerts, (entry) => isTimeOrNull(entry.resolveAt))
        && everyValue(parsed.rowsSeen, (entry) => typeof entry.active === 'boolean'
            && (0, types_1.isSeverity)(entry.severity) && typeof entry.summary === 'string' && isTime(entry.changedAt))
        && everyValue(parsed.delivered, (entry) => typeof entry.dedupKey === 'string'
            && (0, types_1.isSeverity)(entry.severity) && isTime(entry.openedAt))
        && everyValue(parsed.rejected, (entry) => typeof entry.desiredHash === 'string'
            && isTime(entry.at) && typeof entry.reason === 'string');
    return valid ? parsed : undefined;
}
