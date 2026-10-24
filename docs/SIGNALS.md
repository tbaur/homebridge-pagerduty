# Signal store

The signal store lets another Homebridge plugin raise a PagerDuty alert without an Apple Home automation. The other plugin writes a row to a small SQLite file. This plugin reads it and pages.

This page is the interface. It is written for authors of the plugins that write rows (the writers). If you only use HomeKit switches, you do not need it.

## How it fits together

- The store is one file, `homebridge-pagerduty/signals.sqlite`, inside the Homebridge storage directory (`api.user.storagePath()`, the directory that holds `config.json`). Every child bridge on an install shares that directory, so every plugin process can reach the file. The path is part of this interface and will not change within interface version 1.
- A writer owns the rows whose `plugin` column is its own package name. Each row is one condition, called a signal, such as `sump-high`.
- The user decides which writers may page. A writer is ignored until the user adds its package name to `signals.sources` in this plugin's settings. The plugin logs one `info` line for each writer it sees that is not on that list, so the user can find it.
- An active row opens a PagerDuty alert. Setting `active = 0` or deleting the row resolves it.
- A user can also bind a configured alert to a signal with `"signal": "<plugin>/<signal>"`. The alert's HomeKit switch then follows the row. See [Bound alerts](#bound-alerts).

The store is not opened at all while `signals.sources` is empty.

## Schema

`CREATE TABLE IF NOT EXISTS` means the first process to run it decides what the table looks like. So every writer must run this exact text, unchanged:

```sql
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS signals (
  plugin     TEXT    NOT NULL CHECK (length(plugin) BETWEEN 1 AND 128 AND plugin NOT GLOB '*[^a-z0-9@/._-]*'),
  signal     TEXT    NOT NULL CHECK (length(signal) BETWEEN 1 AND 64 AND signal NOT GLOB '*[^a-z0-9._-]*'),
  active     INTEGER NOT NULL CHECK (active IN (0, 1)),
  severity   TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary    TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 1024),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin, signal)
) STRICT;
```

| Column | Meaning |
|---|---|
| `plugin` | Your npm package name, scoped or not. Only characters that are valid in a package name are allowed. |
| `signal` | Your name for the condition: lowercase letters, digits, dot, underscore and hyphen, up to 64 characters. |
| `active` | `1` while the condition is present, `0` when it has cleared. |
| `severity` | `info`, `warning`, `error` or `critical`, lowercase. PagerDuty maps `critical` and `error` to high urgency. |
| `summary` | The incident title in PagerDuty, 1 to 1024 characters. |
| `updated_at` | Unix time in milliseconds of this write. PagerDuty shows it as the time the condition changed. |

The `CHECK` constraints make a bad write fail inside your plugin, where the bug is.

`PRAGMA user_version` is the interface version, currently `1`. The process that creates the store sets it to `1` when it reads `0`. If you read a higher value, stop writing and log why: the store belongs to a newer interface than your plugin knows.

## Writer rules

1. **Open the file the same way every time.** Create the directory with `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` and the file with `fs.closeSync(fs.openSync(file, 'a', 0o600))`, both owner-only. Then open it read-write, set `PRAGMA busy_timeout` to 1000 ms or less, run the schema above, then check `user_version`. Keep the busy timeout short: `node:sqlite` is synchronous, so a long wait blocks your own bridge process.
2. **Write only rows whose `plugin` is your own package name.**
3. **Upsert when a condition changes,** and set `updated_at` on every write.
4. **When your plugin starts, write the current state of every signal you own,** active or not. That clears anything that ended while Homebridge was down.
5. **Clear a condition with `active = 0`.** Deleting the row also clears it.
6. **Write when something changes, not on a timer.** At most once per second per signal.
7. **Do not depend on the `homebridge-pagerduty` package.** Copy the schema and the few lines below instead.

`node:sqlite` needs Node 22.13 or later. Node 22 prints an `ExperimentalWarning` the first time it is loaded; that is Node, not a fault in the store. Keep the store on a local disk: SQLite's WAL mode does not work on network filesystems.

## Reference writer

[`scripts/reference-writer.js`](../scripts/reference-writer.js) is a complete, runnable writer with no dependencies. The core is:

```js
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

function openStore(storageDir) {
  const dir = path.join(storageDir, 'homebridge-pagerduty')
  const file = path.join(dir, 'signals.sqlite')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const db = new DatabaseSync(file)
  db.exec('PRAGMA busy_timeout = 1000')
  db.exec(SCHEMA) // the schema text above, unchanged
  const version = Number(db.prepare('PRAGMA user_version').get().user_version)
  if (version === 0) {
    db.exec('PRAGMA user_version = 1')
  } else if (version > 1) {
    db.close()
    throw new Error(`signal store is interface version ${version}; not writing`)
  }
  return db
}

function writeSignal(db, { plugin, signal, active, severity, summary }) {
  db.prepare(
    'INSERT INTO signals (plugin, signal, active, severity, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT (plugin, signal) DO UPDATE SET active = excluded.active, severity = excluded.severity, '
    + 'summary = excluded.summary, updated_at = excluded.updated_at',
  ).run(plugin, signal, active ? 1 : 0, severity, summary, Date.now())
}
```

In a plugin, `storageDir` is `api.user.storagePath()`. Open the store once and keep the connection.

To try it from a terminal against a test install:

```bash
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --severity warning --summary "Door open"
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --clear
```

Add `homebridge-example` to `signals.sources` first, or the plugin only logs that it saw the writer.

## What this plugin does with a row

- **It reads only allowed writers.** The allowlist is part of the SQL query, so rows from other writers can never push allowed rows out of the read. At most 1000 rows are read, newest first.
- **A row changes when `active` or `severity` changes.** A new `updated_at` on its own is not a change.
- **An unbound row pages directly,** with `dedup_key` `<source>/<plugin>/<signal>`. In the event, `component` is the signal name, `group` is your package name and `custom_details.origin` is `signal`. Unbound rows have no HomeKit switch, and the maintenance switch holds them.
- **A read error is never a clear.** If the file is missing, busy or corrupt, the last rows read stay in force. The plugin logs a `warn`, at most hourly, and the delivery sensor opens after 5 minutes.
- **A replaced file is noticed.** The plugin checks the file's device and inode number on every poll and reopens when they change.
- **Removing a writer from `signals.sources` resolves its open alerts.**
- **Every value you write that reaches a log line is escaped and length-capped.**

The plugin polls every 2 seconds. A poll is a `stat` and a `PRAGMA data_version` check; rows are read only when one of them changes.

## Bound alerts

A configured alert with `"signal": "homebridge-example/sump-high"` mirrors that row in its HomeKit switch. The last change wins:

- A row change turns the switch on or off, and sets the alert's severity from the row.
- A person can still flip the switch. That sends `trigger` or `resolve` as usual, and it holds until the row next changes. Turning the switch off while the row stays active silences the page.
- The severity is the severity of the last row seen, including when a person turns the switch on by hand. The configured level severity is used only until the first row is seen.
- The incident title is the configured `summary`, so it stays stable. The row's summary goes into `custom_details.detail`.
- A bound alert can use `bypassMaintenance`, which is how a writer can page during maintenance.

## Security

**The allowlist is not authentication.** Any process that runs as the Homebridge user can write any `plugin` value. The allowlist stops a well-behaved plugin from paging someone who never asked it to. It does not stop hostile code. Code running as that user can already read `config.json` and the integration key in it.

The plugin creates the `homebridge-pagerduty` directory owner-only (`0700`), and the store and its `-wal` and `-shm` files owner-only (`0600`). It tightens the files if it finds them looser.
