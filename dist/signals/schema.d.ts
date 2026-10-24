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
import type { CatalogEntry, SignalRef, SignalRow } from '../types';
/** `PRAGMA user_version` for this schema. A writer that reads higher stops. */
export declare const SIGNAL_SCHEMA_VERSION = 1;
/** The schema, verbatim. See the file header before changing a character. */
export declare const SIGNAL_SCHEMA_SQL = "PRAGMA journal_mode = WAL;\nCREATE TABLE IF NOT EXISTS signals (\n  plugin     TEXT    NOT NULL CHECK (length(plugin) BETWEEN 1 AND 128 AND plugin NOT GLOB '*[^a-z0-9@/._-]*'),\n  signal     TEXT    NOT NULL CHECK (length(signal) BETWEEN 1 AND 64 AND signal NOT GLOB '*[^a-z0-9._-]*'),\n  active     INTEGER NOT NULL CHECK (active IN (0, 1)),\n  severity   TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),\n  summary    TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 1024),\n  updated_at INTEGER NOT NULL,\n  PRIMARY KEY (plugin, signal)\n) STRICT;";
/** True for a value usable as a `plugin` column and an allowlist entry. */
export declare function isValidPluginName(value: unknown): value is string;
/** True when a package may be allowed to page. */
export declare function isAllowableSource(value: unknown): value is string;
/** True for a value usable as a `signal` column. */
export declare function isValidSignalName(value: unknown): value is string;
/**
 * Parse `<plugin>/<signal>`.
 *
 * Split at the last `/`, because a scoped package name contains one and a
 * signal name cannot.
 */
export declare function parseSignalRef(value: unknown): SignalRef | undefined;
/** The persisted-state key for a row: `<plugin>/<signal>`. */
export declare function signalRefKey(ref: SignalRef): string;
/**
 * The key a plugin is stored under in `signals`.
 *
 * Config UI X builds JSON pointers from property names without escaping them,
 * so the `/` of a scoped package breaks the settings screen. A package name
 * cannot contain `:`, so `@scope:name` maps back to `@scope/name` unambiguously.
 */
export declare function pluginConfigKey(plugin: string): string;
/** The package name for a `signals` key, or undefined when it is not one. */
export declare function pluginFromConfigKey(key: string): string | undefined;
/** `cloud-offline` becomes `Cloud Offline`. Used until the user names the switch. */
export declare function defaultSignalSwitchName(signal: string): string;
/**
 * Validate one row as read from SQLite.
 *
 * The `CHECK` constraints already stop a bad write, but the table may have been
 * created by a writer that changed the schema text, so nothing read back is
 * trusted on the strength of the constraints alone.
 */
export declare function validateRow(raw: Record<string, unknown>): SignalRow | undefined;
/**
 * Validate one row of the list of every plugin's signals. Rows from this
 * plugin's own name are dropped, because it can never be allowed.
 */
export declare function validateCatalogEntry(raw: Record<string, unknown>): CatalogEntry | undefined;
