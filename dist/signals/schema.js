"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The published signal store interface: the exact schema text,
 * its version, and row validation.
 *
 * `CREATE TABLE IF NOT EXISTS` means the first process to run it decides the
 * table. Every writer therefore runs this text unchanged; docs/SIGNALS.md
 * publishes it verbatim and a test asserts the two match. Changing it is an
 * interface change: raise {@link SIGNAL_SCHEMA_VERSION} and say why.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGNAL_SCHEMA_SQL = exports.SIGNAL_SCHEMA_VERSION = void 0;
exports.isValidPluginName = isValidPluginName;
exports.isAllowableSource = isAllowableSource;
exports.isValidSignalName = isValidSignalName;
exports.parseSignalRef = parseSignalRef;
exports.signalRefKey = signalRefKey;
exports.validateRow = validateRow;
const settings_1 = require("../settings");
const types_1 = require("../types");
/** `PRAGMA user_version` for this schema. A writer that reads higher stops. */
exports.SIGNAL_SCHEMA_VERSION = 1;
/** The schema, verbatim. See the file header before changing a character. */
exports.SIGNAL_SCHEMA_SQL = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS signals (
  plugin     TEXT    NOT NULL CHECK (length(plugin) BETWEEN 1 AND 128 AND plugin NOT GLOB '*[^a-z0-9@/._-]*'),
  signal     TEXT    NOT NULL CHECK (length(signal) BETWEEN 1 AND 64 AND signal NOT GLOB '*[^a-z0-9._-]*'),
  active     INTEGER NOT NULL CHECK (active IN (0, 1)),
  severity   TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary    TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 1024),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin, signal)
) STRICT;`;
/** This plugin's own package name, which may never be a signal source. */
const SELF = 'homebridge-pagerduty';
/**
 * An npm package name, scoped or not, restricted to the characters the schema
 * allows. The schema is the stricter of the two, so it decides.
 */
const PLUGIN_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SIGNAL_NAME = /^[a-z0-9._-]{1,64}$/;
/** True for a value usable as a `plugin` column and an allowlist entry. */
function isValidPluginName(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && PLUGIN_NAME.test(value);
}
/** True when a package may be put on the `signals.sources` allowlist. */
function isAllowableSource(value) {
    return isValidPluginName(value) && value !== SELF;
}
/** True for a value usable as a `signal` column. */
function isValidSignalName(value) {
    return typeof value === 'string' && SIGNAL_NAME.test(value);
}
/**
 * Parse `<plugin>/<signal>`.
 *
 * Split at the last `/`, because a scoped package name contains one and a
 * signal name cannot.
 */
function parseSignalRef(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const slash = value.lastIndexOf('/');
    if (slash <= 0) {
        return undefined;
    }
    const plugin = value.slice(0, slash);
    const signal = value.slice(slash + 1);
    return isValidPluginName(plugin) && isValidSignalName(signal) ? { plugin, signal } : undefined;
}
/** The persisted-state key for a row: `<plugin>/<signal>`. */
function signalRefKey(ref) {
    return `${ref.plugin}/${ref.signal}`;
}
/**
 * Validate one row as read from SQLite.
 *
 * The `CHECK` constraints already stop a bad write, but the table may have been
 * created by a writer that changed the schema text, so nothing read back is
 * trusted on the strength of the constraints alone.
 */
function validateRow(raw) {
    const { plugin, signal, active, severity, summary } = raw;
    const updatedAt = typeof raw.updated_at === 'bigint' ? Number(raw.updated_at) : raw.updated_at;
    if (!isValidPluginName(plugin) || !isValidSignalName(signal) || !(0, types_1.isSeverity)(severity)) {
        return undefined;
    }
    const activeNumber = typeof active === 'bigint' ? Number(active) : active;
    if (activeNumber !== 0 && activeNumber !== 1) {
        return undefined;
    }
    if (typeof summary !== 'string' || summary.length < 1 || summary.length > settings_1.MAX_SUMMARY_LENGTH) {
        return undefined;
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        return undefined;
    }
    return { plugin, signal, active: activeNumber === 1, severity, summary, updatedAt };
}
