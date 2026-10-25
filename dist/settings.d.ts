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
import type { PluginLogger } from './types';
/** npm package name. Must match `package.json` `name` for Homebridge to load us. */
export declare const PLUGIN_NAME = "homebridge-pagerduty";
/** Platform alias used in `config.json` and `config.schema.json`. */
export declare const PLATFORM_NAME = "PagerDuty";
/**
 * Namespace for generated accessory UUIDs.
 *
 * Nothing about the routing key or a display name goes into a UUID, so a new
 * integration key or a renamed tile keeps its room and automations.
 */
export declare const UUID_PREFIX = "homebridge-pagerduty:";
/** Reported when `package.json` cannot be read. */
export declare const UNKNOWN_PLUGIN_VERSION = "0.0.0";
/** Manufacturer shown in Accessory Information. */
export declare const MANUFACTURER = "homebridge-pagerduty";
/** Sent as the event's `client` field, which PagerDuty shows on the alert. */
export declare const EVENT_CLIENT = "Homebridge";
/** Sent as `payload.group` for switch-driven alerts. */
export declare const EVENT_GROUP = "homebridge-pagerduty";
/**
 * Events API v2 endpoints, per region.
 *
 * Constants rather than a free-text URL: the request carries the routing key,
 * so a configurable host would be a configurable place to send it.
 */
export declare const EVENTS_URLS: {
    readonly us: "https://events.pagerduty.com/v2/enqueue";
    readonly eu: "https://events.eu.pagerduty.com/v2/enqueue";
};
/**
 * This plugin's directory inside the Homebridge storage directory. Named after
 * the npm package, which no other plugin can share. Part of the published
 * signal store path, so renaming it breaks every writer.
 */
export declare const DATA_DIR_NAME = "homebridge-pagerduty";
/** Plugin state, in {@link DATA_DIR_NAME}. Private to this plugin. */
export declare const STATE_FILE_NAME = "state.json";
/**
 * The signal store interface identifier, a directory in {@link DATA_DIR_NAME}.
 * Other plugins write to this exact path, so it changes only for a change that
 * would break a writer, never for a release on its own. See "Interface
 * identifier" in docs/SIGNALS.md and the rules in DEVELOPMENT.md.
 */
export declare const SIGNAL_INTERFACE_ID = "signals-2026-10-24";
/** The published signal store, in {@link SIGNAL_INTERFACE_ID}. */
export declare const SIGNAL_STORE_FILE_NAME = "signals.sqlite";
/** Owner-only: alert names and times are nobody else's business. */
export declare const PRIVATE_FILE_MODE = 384;
/** Owner-only, so SQLite's side files are private from the moment they exist. */
export declare const PRIVATE_DIR_MODE = 448;
/** Connect deadline. An unreachable host fails quickly. */
export declare const CONNECT_TIMEOUT_MS = 5000;
/** Total deadline for one request. */
export declare const REQUEST_TIMEOUT_MS = 30000;
/** Largest response accepted. A PagerDuty response is under 1 KiB. */
export declare const MAX_RESPONSE_BYTES = 65536;
/**
 * How long a sendable gap may last before the delivery sensor opens.
 *
 * Longer than a normal retry, so one failed request does not notify anyone,
 * and short enough that a real outage does.
 */
export declare const DELIVERY_FAULT_AFTER_MS = 120000;
/** First wait after a `429` or `408`. PagerDuty asks for a backoff of minutes. */
export declare const RATE_LIMIT_BACKOFF_BASE_MS = 60000;
/** First retry window after a server or network failure. */
export declare const BACKOFF_BASE_MS = 5000;
/** Shared ceiling for both backoffs. */
export declare const BACKOFF_MAX_MS = 300000;
/** Longest `Retry-After` honoured. Beyond this the header is treated as a cap. */
export declare const MAX_RETRY_AFTER_MS = 900000;
/**
 * How often a continuing outage may warn again.
 *
 * The first failure warns and the recovery answers it. An outage that lasts a
 * day must not write a warning per retry.
 */
export declare const OUTAGE_REWARN_MS: number;
/** How often the delivery sensor is re-evaluated while anything is pending. */
export declare const DELIVERY_HEALTH_TICK_MS = 5000;
/** Poll interval: one `stat` and one `PRAGMA data_version`. Rows are read only on change. */
export declare const SIGNAL_POLL_MS = 2000;
/** How long the store may be unreadable before the delivery sensor opens. */
export declare const SIGNAL_STORE_FAULT_AFTER_MS = 300000;
/**
 * SQLite busy timeout for this plugin's connection.
 *
 * `DatabaseSync` is synchronous, so a busy wait blocks the whole bridge
 * process. On `SQLITE_BUSY` the reader skips the poll and keeps the last rows.
 */
export declare const READER_BUSY_TIMEOUT_MS = 250;
/**
 * Read cap, applied after the allowlist filter in the query. The query asks
 * for one row more, so a read of exactly this many is known to be complete.
 */
export declare const MAX_SIGNAL_ROWS = 1000;
/** Plugins shown under Plugin Signals and accepted in `signals`. */
export declare const MAX_SIGNAL_PLUGINS = 20;
/** Signals per plugin shown under Plugin Signals and accepted in `signals`. */
export declare const MAX_SIGNALS_PER_PLUGIN = 50;
/** Read cap for the list of every plugin's signals, which only feeds the settings screen. */
export declare const MAX_CATALOG_ROWS: number;
/**
 * Rows scanned to fill the catalog. The table's `CHECK` accepts some names that
 * validation rejects, so the cap on valid rows is applied after validation,
 * and this bounds the scan.
 */
export declare const MAX_CATALOG_SCAN_ROWS: number;
/** Rejected in any name or text this plugin accepts from config or another plugin. */
export declare const CONTROL_CHARACTERS: RegExp;
/**
 * Signal switches exposed. With every alert at four levels, the maintenance
 * switch and the delivery sensor, this stays inside the 149 accessories a
 * bridge can hold.
 */
export declare const MAX_SIGNAL_SWITCHES = 20;
/** `severity` value in `signals` that keeps the plugin's own severity. */
export declare const SEVERITY_FROM_PLUGIN = "plugin";
/**
 * Must match `dynamicSchemaVersion` in `config.schema.json`. Config UI X then
 * reads `<storage>/.homebridge-pagerduty-v<version>.schema.json` instead of
 * the static schema.
 */
export declare const DYNAMIC_SCHEMA_VERSION = 1;
/** The settings screen this plugin writes, in the storage directory itself. */
export declare const DYNAMIC_SCHEMA_FILE_NAME = ".homebridge-pagerduty-v1.schema.json";
/**
 * Most alerts accepted.
 *
 * Four levels each plus the maintenance switch and the delivery sensor stays
 * well inside the 149 accessories a Homebridge bridge can hold.
 */
export declare const MAX_ALERTS = 30;
/** Most severity levels per alert: one per PagerDuty severity. */
export declare const MAX_LEVELS = 4;
/** PagerDuty's limit on `payload.summary`. */
export declare const MAX_SUMMARY_LENGTH = 1024;
/** Longest accepted HomeKit display name. */
export declare const MAX_NAME_LENGTH = 64;
/** HomeKit names used until the user sets their own. */
export declare const DEFAULT_MAINTENANCE_NAME = "PagerDuty Maintenance";
export declare const DEFAULT_DELIVERY_SENSOR_NAME = "PagerDuty Delivery";
/** Longest untrusted string interpolated into a log line. */
export declare const MAX_LOG_FIELD_LENGTH = 100;
/** Resolve timer range, minutes. 0 is off; the top is one week. */
export declare const MAX_RESOLVE_AFTER_MINUTES = 10080;
/** Maintenance auto-off, minutes. There is deliberately no "forever". */
export declare const DEFAULT_MAINTENANCE_MAX_MINUTES = 240;
export declare const MIN_MAINTENANCE_MAX_MINUTES = 15;
export declare const MAX_MAINTENANCE_MAX_MINUTES = 10080;
/** Default `payload.source` and first part of every `dedup_key`. */
export declare const DEFAULT_SOURCE = "homebridge";
/** Diagnostics heartbeat: off by default, then 30–3600 s. */
export declare const DEFAULT_DIAGNOSTICS_INTERVAL_SEC = 0;
export declare const MIN_DIAGNOSTICS_INTERVAL_SEC = 30;
export declare const MAX_DIAGNOSTICS_INTERVAL_SEC = 3600;
/**
 * Read this plugin's version from `package.json`.
 *
 * Reported to HomeKit as FirmwareRevision, which makes the version visible in
 * the Home app and therefore in bug reports. Also part of every rejection
 * hash, so an upgrade that fixes the cause of a `400` sends the event again.
 */
export declare function readPluginVersion(log?: PluginLogger): string;
