"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants and the plugin version reader.
 *
 * Every number here is either a fact from PagerDuty's documentation or a
 * policy we chose. Each says which, so a future reader can tell the two apart
 * and knows which ones are free to change. See docs/EVENTS-API.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_DIAGNOSTICS_INTERVAL_SEC = exports.DEFAULT_DIAGNOSTICS_INTERVAL_SEC = exports.DEFAULT_SOURCE = exports.MAX_MAINTENANCE_MAX_MINUTES = exports.MIN_MAINTENANCE_MAX_MINUTES = exports.DEFAULT_MAINTENANCE_MAX_MINUTES = exports.MAX_RESOLVE_AFTER_MINUTES = exports.MAX_LOG_FIELD_LENGTH = exports.DEFAULT_DELIVERY_SENSOR_NAME = exports.DEFAULT_MAINTENANCE_NAME = exports.MAX_NAME_LENGTH = exports.MAX_SUMMARY_LENGTH = exports.MAX_LEVELS = exports.MAX_ALERTS = exports.DYNAMIC_SCHEMA_FILE_NAME = exports.DYNAMIC_SCHEMA_VERSION = exports.SEVERITY_FROM_PLUGIN = exports.MAX_SIGNAL_SWITCHES = exports.CONTROL_CHARACTERS = exports.MAX_CATALOG_SCAN_ROWS = exports.MAX_CATALOG_ROWS = exports.MAX_SIGNALS_PER_PLUGIN = exports.MAX_SIGNAL_PLUGINS = exports.MAX_SIGNAL_ROWS = exports.READER_BUSY_TIMEOUT_MS = exports.SIGNAL_STORE_FAULT_AFTER_MS = exports.SIGNAL_POLL_MS = exports.DELIVERY_HEALTH_TICK_MS = exports.OUTAGE_REWARN_MS = exports.MAX_RETRY_AFTER_MS = exports.BACKOFF_MAX_MS = exports.BACKOFF_BASE_MS = exports.RATE_LIMIT_BACKOFF_BASE_MS = exports.DELIVERY_FAULT_AFTER_MS = exports.MAX_RESPONSE_BYTES = exports.REQUEST_TIMEOUT_MS = exports.CONNECT_TIMEOUT_MS = exports.PRIVATE_DIR_MODE = exports.PRIVATE_FILE_MODE = exports.SIGNAL_STORE_FILE_NAME = exports.STATE_FILE_NAME = exports.DATA_DIR_NAME = exports.EVENTS_URLS = exports.EVENT_GROUP = exports.EVENT_CLIENT = exports.MANUFACTURER = exports.UNKNOWN_PLUGIN_VERSION = exports.UUID_PREFIX = exports.PLATFORM_NAME = exports.PLUGIN_NAME = void 0;
exports.MAX_DIAGNOSTICS_INTERVAL_SEC = void 0;
exports.readPluginVersion = readPluginVersion;
/** npm package name. Must match `package.json` `name` for Homebridge to load us. */
exports.PLUGIN_NAME = 'homebridge-pagerduty';
/** Platform alias used in `config.json` and `config.schema.json`. */
exports.PLATFORM_NAME = 'PagerDuty';
/**
 * Namespace for generated accessory UUIDs.
 *
 * Nothing about the routing key or a display name goes into a UUID, so a new
 * integration key or a renamed tile keeps its room and automations.
 */
exports.UUID_PREFIX = 'homebridge-pagerduty:';
/** Reported when `package.json` cannot be read. */
exports.UNKNOWN_PLUGIN_VERSION = '0.0.0';
/** Manufacturer shown in Accessory Information. */
exports.MANUFACTURER = 'homebridge-pagerduty';
/** Sent as the event's `client` field, which PagerDuty shows on the alert. */
exports.EVENT_CLIENT = 'Homebridge';
/** Sent as `payload.group` for switch-driven alerts. */
exports.EVENT_GROUP = 'homebridge-pagerduty';
// --- Endpoints ---------------------------------------------------------------
/**
 * Events API v2 endpoints, per region.
 *
 * Constants rather than a free-text URL: the request carries the routing key,
 * so a configurable host would be a configurable place to send it.
 */
exports.EVENTS_URLS = {
    us: 'https://events.pagerduty.com/v2/enqueue',
    eu: 'https://events.eu.pagerduty.com/v2/enqueue',
};
// --- Files -------------------------------------------------------------------
/**
 * This plugin's directory inside the Homebridge storage directory. Named after
 * the npm package, which no other plugin can share. Part of the published
 * signal store path, so renaming it breaks every writer.
 */
exports.DATA_DIR_NAME = 'homebridge-pagerduty';
/** Plugin state, in {@link DATA_DIR_NAME}. Private to this plugin. */
exports.STATE_FILE_NAME = 'state.json';
/** The published signal store, in {@link DATA_DIR_NAME}. See docs/SIGNALS.md. */
exports.SIGNAL_STORE_FILE_NAME = 'signals.sqlite';
/** Owner-only: alert names and times are nobody else's business. */
exports.PRIVATE_FILE_MODE = 0o600;
/** Owner-only, so SQLite's side files are private from the moment they exist. */
exports.PRIVATE_DIR_MODE = 0o700;
// --- Delivery ----------------------------------------------------------------
/** Connect deadline. An unreachable host fails quickly. */
exports.CONNECT_TIMEOUT_MS = 5_000;
/** Total deadline for one request. */
exports.REQUEST_TIMEOUT_MS = 30_000;
/** Largest response accepted. A PagerDuty response is under 1 KiB. */
exports.MAX_RESPONSE_BYTES = 65_536;
/**
 * How long a sendable gap may last before the delivery sensor opens.
 *
 * Longer than a normal retry, so one failed request does not notify anyone,
 * and short enough that a real outage does.
 */
exports.DELIVERY_FAULT_AFTER_MS = 120_000;
/** First wait after a `429` or `408`. PagerDuty asks for a backoff of minutes. */
exports.RATE_LIMIT_BACKOFF_BASE_MS = 60_000;
/** First retry window after a server or network failure. */
exports.BACKOFF_BASE_MS = 5_000;
/** Shared ceiling for both backoffs. */
exports.BACKOFF_MAX_MS = 300_000;
/** Longest `Retry-After` honoured. Beyond this the header is treated as a cap. */
exports.MAX_RETRY_AFTER_MS = 900_000;
/**
 * How often a continuing outage may warn again.
 *
 * The first failure warns and the recovery answers it. An outage that lasts a
 * day must not write a warning per retry.
 */
exports.OUTAGE_REWARN_MS = 60 * 60 * 1_000;
/** How often the delivery sensor is re-evaluated while anything is pending. */
exports.DELIVERY_HEALTH_TICK_MS = 5_000;
// --- Signal store ------------------------------------------------------------
/** Poll interval: one `stat` and one `PRAGMA data_version`. Rows are read only on change. */
exports.SIGNAL_POLL_MS = 2_000;
/** How long the store may be unreadable before the delivery sensor opens. */
exports.SIGNAL_STORE_FAULT_AFTER_MS = 300_000;
/**
 * SQLite busy timeout for this plugin's connection.
 *
 * `DatabaseSync` is synchronous, so a busy wait blocks the whole bridge
 * process. On `SQLITE_BUSY` the reader skips the poll and keeps the last rows.
 */
exports.READER_BUSY_TIMEOUT_MS = 250;
/**
 * Read cap, applied after the allowlist filter in the query. The query asks
 * for one row more, so a read of exactly this many is known to be complete.
 */
exports.MAX_SIGNAL_ROWS = 1_000;
/** Plugins shown under Plugin Signals and accepted in `signals`. */
exports.MAX_SIGNAL_PLUGINS = 20;
/** Signals per plugin shown under Plugin Signals and accepted in `signals`. */
exports.MAX_SIGNALS_PER_PLUGIN = 50;
/** Read cap for the list of every plugin's signals, which only feeds the settings screen. */
exports.MAX_CATALOG_ROWS = exports.MAX_SIGNAL_PLUGINS * exports.MAX_SIGNALS_PER_PLUGIN;
/**
 * Rows scanned to fill the catalog. The table's `CHECK` accepts some names that
 * validation rejects, so the cap on valid rows is applied after validation,
 * and this bounds the scan.
 */
exports.MAX_CATALOG_SCAN_ROWS = exports.MAX_CATALOG_ROWS * 5;
/** Rejected in any name or text this plugin accepts from config or another plugin. */
exports.CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
/**
 * Signal switches exposed. With every alert at four levels, the maintenance
 * switch and the delivery sensor, this stays inside the 149 accessories a
 * bridge can hold.
 */
exports.MAX_SIGNAL_SWITCHES = 20;
/** `severity` value in `signals` that keeps the plugin's own severity. */
exports.SEVERITY_FROM_PLUGIN = 'plugin';
// --- Settings screen ---------------------------------------------------------
/**
 * Must match `dynamicSchemaVersion` in `config.schema.json`. Config UI X then
 * reads `<storage>/.homebridge-pagerduty-v<version>.schema.json` instead of
 * the static schema.
 */
exports.DYNAMIC_SCHEMA_VERSION = 1;
/** The settings screen this plugin writes, in the storage directory itself. */
exports.DYNAMIC_SCHEMA_FILE_NAME = `.homebridge-pagerduty-v${exports.DYNAMIC_SCHEMA_VERSION}.schema.json`;
// --- Limits ------------------------------------------------------------------
/**
 * Most alerts accepted.
 *
 * Four levels each plus the maintenance switch and the delivery sensor stays
 * well inside the 149 accessories a Homebridge bridge can hold.
 */
exports.MAX_ALERTS = 30;
/** Most severity levels per alert: one per PagerDuty severity. */
exports.MAX_LEVELS = 4;
/** PagerDuty's limit on `payload.summary`. */
exports.MAX_SUMMARY_LENGTH = 1_024;
/** Longest accepted HomeKit display name. */
exports.MAX_NAME_LENGTH = 64;
/** HomeKit names used until the user sets their own. */
exports.DEFAULT_MAINTENANCE_NAME = 'PagerDuty Maintenance';
exports.DEFAULT_DELIVERY_SENSOR_NAME = 'PagerDuty Delivery';
/** Longest untrusted string interpolated into a log line. */
exports.MAX_LOG_FIELD_LENGTH = 100;
/** Resolve timer range, minutes. 0 is off; the top is one week. */
exports.MAX_RESOLVE_AFTER_MINUTES = 10_080;
/** Maintenance auto-off, minutes. There is deliberately no "forever". */
exports.DEFAULT_MAINTENANCE_MAX_MINUTES = 240;
exports.MIN_MAINTENANCE_MAX_MINUTES = 15;
exports.MAX_MAINTENANCE_MAX_MINUTES = 10_080;
/** Default `payload.source` and first part of every `dedup_key`. */
exports.DEFAULT_SOURCE = 'homebridge';
/** Diagnostics heartbeat: off by default, then 30–3600 s. */
exports.DEFAULT_DIAGNOSTICS_INTERVAL_SEC = 0;
exports.MIN_DIAGNOSTICS_INTERVAL_SEC = 30;
exports.MAX_DIAGNOSTICS_INTERVAL_SEC = 3_600;
let cachedVersion;
/**
 * Read this plugin's version from `package.json`.
 *
 * Reported to HomeKit as FirmwareRevision, which makes the version visible in
 * the Home app and therefore in bug reports. Also part of every rejection
 * hash, so an upgrade that fixes the cause of a `400` sends the event again.
 */
function readPluginVersion(log) {
    if (cachedVersion !== undefined) {
        return cachedVersion;
    }
    try {
        const pkg = require('../package.json');
        cachedVersion = typeof pkg.version === 'string' && pkg.version.length > 0
            ? pkg.version
            : exports.UNKNOWN_PLUGIN_VERSION;
    }
    catch (error) {
        log?.debug(`could not read plugin version: ${String(error)}`);
        cachedVersion = exports.UNKNOWN_PLUGIN_VERSION;
    }
    return cachedVersion;
}
