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

import type { PluginLogger } from './types'

/** npm package name. Must match `package.json` `name` for Homebridge to load us. */
export const PLUGIN_NAME = 'homebridge-pagerduty'

/** Platform alias used in `config.json` and `config.schema.json`. */
export const PLATFORM_NAME = 'PagerDuty'

/**
 * Namespace for generated accessory UUIDs.
 *
 * Nothing about the routing key or a display name goes into a UUID, so a new
 * integration key or a renamed tile keeps its room and automations.
 */
export const UUID_PREFIX = 'homebridge-pagerduty:'

/** Reported when `package.json` cannot be read. */
export const UNKNOWN_PLUGIN_VERSION = '0.0.0'

/** Manufacturer shown in Accessory Information. */
export const MANUFACTURER = 'homebridge-pagerduty'

/** Sent as the event's `client` field, which PagerDuty shows on the alert. */
export const EVENT_CLIENT = 'Homebridge'

/** Sent as `payload.group` for switch-driven alerts. */
export const EVENT_GROUP = 'homebridge-pagerduty'

// --- Endpoints ---------------------------------------------------------------

/**
 * Events API v2 endpoints, per region.
 *
 * Constants rather than a free-text URL: the request carries the routing key,
 * so a configurable host would be a configurable place to send it.
 */
export const EVENTS_URLS = {
  us: 'https://events.pagerduty.com/v2/enqueue',
  eu: 'https://events.eu.pagerduty.com/v2/enqueue',
} as const

// --- Files -------------------------------------------------------------------

/**
 * This plugin's directory inside the Homebridge storage directory. Named after
 * the npm package, which no other plugin can share. Part of the published
 * signal store path, so renaming it breaks every writer.
 */
export const DATA_DIR_NAME = 'homebridge-pagerduty'

/** Plugin state, in {@link DATA_DIR_NAME}. Private to this plugin. */
export const STATE_FILE_NAME = 'state.json'

/** The published signal store, in {@link DATA_DIR_NAME}. See docs/SIGNALS.md. */
export const SIGNAL_STORE_FILE_NAME = 'signals.sqlite'

/** Owner-only: alert names and times are nobody else's business. */
export const PRIVATE_FILE_MODE = 0o600

/** Owner-only, so SQLite's side files are private from the moment they exist. */
export const PRIVATE_DIR_MODE = 0o700

// --- Delivery ----------------------------------------------------------------

/** Connect deadline. An unreachable host fails quickly. */
export const CONNECT_TIMEOUT_MS = 5_000

/** Total deadline for one request. */
export const REQUEST_TIMEOUT_MS = 30_000

/** Largest response accepted. A PagerDuty response is under 1 KiB. */
export const MAX_RESPONSE_BYTES = 65_536

/**
 * How long a sendable gap may last before the delivery sensor opens.
 *
 * Longer than a normal retry, so one failed request does not notify anyone,
 * and short enough that a real outage does.
 */
export const DELIVERY_FAULT_AFTER_MS = 120_000

/** First wait after a `429` or `408`. PagerDuty asks for a backoff of minutes. */
export const RATE_LIMIT_BACKOFF_BASE_MS = 60_000

/** First retry window after a server or network failure. */
export const BACKOFF_BASE_MS = 5_000

/** Shared ceiling for both backoffs. */
export const BACKOFF_MAX_MS = 300_000

/** Longest `Retry-After` honoured. Beyond this the header is treated as a cap. */
export const MAX_RETRY_AFTER_MS = 900_000

/**
 * How often a continuing outage may warn again.
 *
 * The first failure warns and the recovery answers it. An outage that lasts a
 * day must not write a warning per retry.
 */
export const OUTAGE_REWARN_MS = 60 * 60 * 1_000

/** How often the delivery sensor is re-evaluated while anything is pending. */
export const DELIVERY_HEALTH_TICK_MS = 5_000

// --- Signal store ------------------------------------------------------------

/** Poll interval: one `stat` and one `PRAGMA data_version`. Rows are read only on change. */
export const SIGNAL_POLL_MS = 2_000

/** How long the store may be unreadable before the delivery sensor opens. */
export const SIGNAL_STORE_FAULT_AFTER_MS = 300_000

/**
 * SQLite busy timeout for this plugin's connection.
 *
 * `DatabaseSync` is synchronous, so a busy wait blocks the whole bridge
 * process. On `SQLITE_BUSY` the reader skips the poll and keeps the last rows.
 */
export const READER_BUSY_TIMEOUT_MS = 250

/** Read cap, applied after the allowlist filter in the query. */
export const MAX_SIGNAL_ROWS = 1_000

/** Plugins shown under Plugin Signals and accepted in `signals`. */
export const MAX_SIGNAL_PLUGINS = 20

/** Signals per plugin shown under Plugin Signals and accepted in `signals`. */
export const MAX_SIGNALS_PER_PLUGIN = 50

/** Read cap for the list of every plugin's signals, which only feeds the settings screen. */
export const MAX_CATALOG_ROWS = MAX_SIGNAL_PLUGINS * MAX_SIGNALS_PER_PLUGIN

/**
 * Signal switches exposed. With every alert at four levels, the maintenance
 * switch and the delivery sensor, this stays inside the 149 accessories a
 * bridge can hold.
 */
export const MAX_SIGNAL_SWITCHES = 20

/** `severity` value in `signals` that keeps the plugin's own severity. */
export const SEVERITY_FROM_PLUGIN = 'plugin'

// --- Settings screen ---------------------------------------------------------

/**
 * Must match `dynamicSchemaVersion` in `config.schema.json`. Config UI X then
 * reads `<storage>/.homebridge-pagerduty-v<version>.schema.json` instead of
 * the static schema.
 */
export const DYNAMIC_SCHEMA_VERSION = 1

/** The settings screen this plugin writes, in the storage directory itself. */
export const DYNAMIC_SCHEMA_FILE_NAME = `.homebridge-pagerduty-v${DYNAMIC_SCHEMA_VERSION}.schema.json`

// --- Limits ------------------------------------------------------------------

/**
 * Most alerts accepted.
 *
 * Four levels each plus the maintenance switch and the delivery sensor stays
 * well inside the 149 accessories a Homebridge bridge can hold.
 */
export const MAX_ALERTS = 30

/** Most severity levels per alert: one per PagerDuty severity. */
export const MAX_LEVELS = 4

/** PagerDuty's limit on `payload.summary`. */
export const MAX_SUMMARY_LENGTH = 1_024

/** Longest accepted HomeKit display name. */
export const MAX_NAME_LENGTH = 64

/** HomeKit names used until the user sets their own. */
export const DEFAULT_MAINTENANCE_NAME = 'PagerDuty Maintenance'
export const DEFAULT_DELIVERY_SENSOR_NAME = 'PagerDuty Delivery'

/** Longest untrusted string interpolated into a log line. */
export const MAX_LOG_FIELD_LENGTH = 100

/** Resolve timer range, minutes. 0 is off; the top is one week. */
export const MAX_RESOLVE_AFTER_MINUTES = 10_080

/** Maintenance auto-off, minutes. There is deliberately no "forever". */
export const DEFAULT_MAINTENANCE_MAX_MINUTES = 240
export const MIN_MAINTENANCE_MAX_MINUTES = 15
export const MAX_MAINTENANCE_MAX_MINUTES = 10_080

/** Default `payload.source` and first part of every `dedup_key`. */
export const DEFAULT_SOURCE = 'homebridge'

/** Diagnostics heartbeat: off by default, then 30–3600 s. */
export const DEFAULT_DIAGNOSTICS_INTERVAL_SEC = 0
export const MIN_DIAGNOSTICS_INTERVAL_SEC = 30
export const MAX_DIAGNOSTICS_INTERVAL_SEC = 3_600

let cachedVersion: string | undefined

/**
 * Read this plugin's version from `package.json`.
 *
 * Reported to HomeKit as FirmwareRevision, which makes the version visible in
 * the Home app and therefore in bug reports. Also part of every rejection
 * hash, so an upgrade that fixes the cause of a `400` sends the event again.
 */
export function readPluginVersion(log?: PluginLogger): string {
  if (cachedVersion !== undefined) {
    return cachedVersion
  }
  try {
    const pkg = require('../package.json') as { version?: unknown }
    cachedVersion = typeof pkg.version === 'string' && pkg.version.length > 0
      ? pkg.version
      : UNKNOWN_PLUGIN_VERSION
  } catch (error) {
    log?.debug(`could not read plugin version: ${String(error)}`)
    cachedVersion = UNKNOWN_PLUGIN_VERSION
  }
  return cachedVersion
}
