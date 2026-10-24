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
exports.pluginConfigKey = pluginConfigKey;
exports.pluginFromConfigKey = pluginFromConfigKey;
exports.defaultSignalSwitchName = defaultSignalSwitchName;
exports.validateRow = validateRow;
exports.validateCatalogEntry = validateCatalogEntry;
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
/**
 * An npm package name, scoped or not, restricted to the characters the schema
 * allows. The schema is the stricter of the two, so it decides.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SIGNAL_NAME = /^[a-z0-9._-]{1,64}$/;
/** True for a value usable as a `plugin` column and an allowlist entry. */
function isValidPluginName(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && PACKAGE_NAME.test(value);
}
/** True when a package may be allowed to page. */
function isAllowableSource(value) {
    return isValidPluginName(value) && value !== settings_1.PLUGIN_NAME;
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
 * The key a plugin is stored under in `signals`.
 *
 * Config UI X builds JSON pointers from property names without escaping them,
 * so the `/` of a scoped package breaks the settings screen. A package name
 * cannot contain `:`, so `@scope:name` maps back to `@scope/name` unambiguously.
 */
function pluginConfigKey(plugin) {
    return plugin.replace('/', ':');
}
/** The package name for a `signals` key, or undefined when it is not one. */
function pluginFromConfigKey(key) {
    const plugin = key.replace(':', '/');
    return !plugin.includes(':') && isAllowableSource(plugin) ? plugin : undefined;
}
/** `cloud-offline` becomes `Cloud Offline`. Used until the user names the switch. */
function defaultSignalSwitchName(signal) {
    const words = signal.split(/[-_.]+/).filter((word) => word.length > 0);
    const name = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ');
    return name.length > 0 ? name : signal;
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
    if (!isValidSummary(summary)) {
        return undefined;
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        return undefined;
    }
    return { plugin, signal, active: activeNumber === 1, severity, summary, updatedAt };
}
/**
 * Validate one row of the list of every plugin's signals. Rows from this
 * plugin's own name are dropped, because it can never be allowed.
 */
function validateCatalogEntry(raw) {
    const { plugin, signal, summary } = raw;
    return isAllowableSource(plugin) && isValidSignalName(signal) && isValidSummary(summary)
        ? { plugin, signal, summary }
        : undefined;
}
function isValidSummary(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= settings_1.MAX_SUMMARY_LENGTH;
}
