# Signal store: instructions for coding agents

You are adding signal support to a Homebridge plugin, so that it can page people through [homebridge-pagerduty](https://github.com/tbaur/homebridge-pagerduty). This file is the whole specification. It has the rules, the code to copy, the tests to write and the README text to add. You do not need any other file.

The examples use `homebridge-example`. Use the plugin's real package name from its `package.json` everywhere it appears.

## How it works

- homebridge-pagerduty reads a SQLite file in the Homebridge storage directory. Other plugins write rows to it.
- Each row is one condition that a person should know about, called a signal, such as `sump-high`.
- While a row has `active = 1`, homebridge-pagerduty keeps a PagerDuty alert open for it. When the row changes to `active = 0`, it resolves the alert.
- Once the plugin has written a row, it appears with its signals under **Plugin Signals** in homebridge-pagerduty's settings screen, after the next restart. homebridge-pagerduty ignores every row until the user checks **Allow this plugin to page** there. The writing plugin cannot change that setting, and must not try.
- For each signal, the user can change the PagerDuty message and severity, let it page during maintenance, mute it, or give it a HomeKit switch. The writing plugin does not need to do anything for that.
- homebridge-pagerduty checks the file every 2 seconds. Only a change to `active` or `severity` sends anything to PagerDuty.

## Do not

- Do not add a dependency on `homebridge-pagerduty`, and do not import from it.
- Do not import `node:sqlite` at the top of a file. On a Node version without it, the whole plugin would fail to load.
- Do not change the table definition in any way.
- Do not write rows with any `plugin` value other than this plugin's package name.
- Do not clear signals on shutdown. The conditions still exist, and the write at the next startup corrects anything that changed.
- Do not write on a timer, or more than once per second for one signal.
- Do not put a credential, token, address or person's name in a summary. Summaries are sent to PagerDuty.
- Do not raise the plugin's `engines.node` for this feature.
- Do not create the store unless the user turned the feature on.

## Steps

If the plugin already writes signals, this is an update. Replace its copy of the module with the one in [Module to copy](#module-to-copy), and replace its setting description and README section with the ones below. Remove any test that reads or sets `PRAGMA user_version`, and add any test from [Tests](#tests) that it does not have yet. Keep the signal names as they are. Then go through [Done when](#done-when).

1. **Read the plugin.** Find its package name, its language and module format, its `engines.node` range, where it learns that a condition started or ended, its `config.schema.json`, its tests and its README.
2. **Choose the signals.** Report only conditions that need a person, such as a leak, a device that went offline, or a failed backup. For each one, choose:
   - a name: lowercase letters, digits, dot, underscore and hyphen, up to 64 characters, such as `hub-offline`;
   - a severity: `info`, `warning`, `error` or `critical`;
   - a summary that a person on call understands without context, such as `Sump water level is high`. 1 to 1024 characters, on one line.

   Signal names become a public interface once released, because each user's settings for a signal are saved under its name. Do not rename them later.

   The summary is also the starting value of the user's PagerDuty Message setting for that signal, and saving the settings screen keeps it as fixed text. Write a summary that still reads well as a fixed message. If it includes changing detail, homebridge-pagerduty sends the current text as a detail field when the user's message differs.
3. **Add a setting,** off by default, and make sure the settings screen shows it. See [Setting](#setting).
4. **Add the module** from [Module to copy](#module-to-copy) as one file, for example `src/pagerduty-signals.ts`. Copy it unchanged. For a JavaScript plugin, remove the type annotations, the `import type` line and the `export type` and `export interface` declarations.
5. **Connect it to the plugin.** See [Wiring](#wiring).
6. **Add tests.** See [Tests](#tests).
7. **Document it.** Add the section from [README section](#readme-section) to the plugin's README.
8. **Check it end to end,** if a test Homebridge with homebridge-pagerduty is available. Set homebridge-pagerduty's `options.dryRun` to `true`, so that it logs each event it would send and pages no one. Write the signals once and restart Homebridge, then check **Allow this plugin to page** for `homebridge-example` under **Plugin Signals**, save and restart. Then trigger a condition and look for the event in the Homebridge log. After a restart, homebridge-pagerduty's startup log also lists the signals it found, in a line such as `Signals from homebridge-example: hub-offline, sump-high`.

## Specification

The module below implements all of this. This section is here so that you can check it, or write a writer in another form.

### File

```text
<storage>/homebridge-pagerduty/signals-2026-10-24/signals.sqlite
```

`<storage>` is `api.user.storagePath()`. Create both directories with mode `0700` and the file with mode `0600` before SQLite opens it. Keep the store on a local disk: SQLite's WAL mode does not work on network filesystems.

`signals-2026-10-24` is the interface identifier. It names this table definition and these rules, and it is not homebridge-pagerduty's version. It changes only for a change that would break a writer, and homebridge-pagerduty keeps reading an identifier until at least its next major version. Use the identifier from this file. Do not look for other directories, and do not write to more than one.

### Table definition

Run this exact text every time the store is opened. The first process to run `CREATE TABLE IF NOT EXISTS` defines the table for every other process.

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

| Column | Value |
|---|---|
| `plugin` | This plugin's npm package name. |
| `signal` | The condition's name. |
| `active` | `1` while the condition is present, `0` once it has cleared. |
| `severity` | `info`, `warning`, `error` or `critical`. |
| `summary` | The alert title in PagerDuty, on one line. |
| `updated_at` | The time of the write, in Unix milliseconds. |

### Opening the store

1. Create the directory and the file, owner-only.
2. Open the file read-write, and set `PRAGMA busy_timeout` to 1000 ms or less. `node:sqlite` is synchronous, so a long wait blocks the whole bridge process.
3. Run the table definition. Do not read or set `PRAGMA user_version`: the directory names the interface.

Open the store once and keep the connection.

### Writing

- At startup, write every signal the plugin owns, active or not. That clears any condition that ended while Homebridge was down.
- When a condition changes, insert or update its row, and set `updated_at`. A new summary or severity while `active` stays `1` updates the open alert, unless the user set their own message. Changing only `updated_at` does not.
- To clear a condition, write `active = 0`. Deleting the row also clears it.
- When a condition goes away for good, for example a device removed from the config, write `active = 0` or delete its row.

`node:sqlite` needs Node 22.13 or later. On Node 22, it prints an `ExperimentalWarning` the first time it loads. That warning comes from Node and is harmless.

## Module to copy

```ts
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import type * as Sqlite from 'node:sqlite'

export type SignalSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface SignalState {
  active: boolean
  severity: SignalSeverity
  summary: string
}

export interface PagerDutySignalsOptions {
  /** This plugin's npm package name, exactly as in package.json. */
  plugin: string
  /** `api.user.storagePath()` */
  storagePath: string
  log: { warn(message: string): void }
}

const STORE_DIR = 'homebridge-pagerduty'
// The signal store interface this module writes. Change it only by copying a
// newer version of this module from homebridge-pagerduty's docs/SIGNALS-AGENT.md.
const INTERFACE_ID = 'signals-2026-10-24'
const STORE_FILE = 'signals.sqlite'
const MAX_SUMMARY_LENGTH = 1024
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]+/g

// The table definition of interface signals-2026-10-24. Every writer must run
// this exact text: the first process to run it defines the table.
const SCHEMA = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS signals (
  plugin     TEXT    NOT NULL CHECK (length(plugin) BETWEEN 1 AND 128 AND plugin NOT GLOB '*[^a-z0-9@/._-]*'),
  signal     TEXT    NOT NULL CHECK (length(signal) BETWEEN 1 AND 64 AND signal NOT GLOB '*[^a-z0-9._-]*'),
  active     INTEGER NOT NULL CHECK (active IN (0, 1)),
  severity   TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary    TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 1024),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin, signal)
) STRICT;`

const UPSERT = 'INSERT INTO signals (plugin, signal, active, severity, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
  + 'ON CONFLICT (plugin, signal) DO UPDATE SET active = excluded.active, severity = excluded.severity, '
  + 'summary = excluded.summary, updated_at = excluded.updated_at'

/**
 * Writes this plugin's conditions to the homebridge-pagerduty signal store.
 * Never throws: a failure is logged once, and the next write tries again.
 */
export class PagerDutySignals {
  private readonly options: PagerDutySignalsOptions
  private db: Sqlite.DatabaseSync | undefined
  private readonly lastWritten = new Map<string, string>()
  private isDisabled = false
  private hasWarned = false

  constructor(options: PagerDutySignalsOptions) {
    this.options = options
  }

  /** Record a signal's current state. Skipped when nothing changed since the last write. */
  write(signal: string, state: SignalState): void {
    const summary = state.summary.replace(CONTROL_CHARACTERS, ' ').slice(0, MAX_SUMMARY_LENGTH)
    const fingerprint = `${state.active ? 1 : 0}|${state.severity}|${summary}`
    if (this.isDisabled || this.lastWritten.get(signal) === fingerprint) {
      return
    }
    try {
      const db = this.db ?? this.open()
      db.prepare(UPSERT).run(this.options.plugin, signal, state.active ? 1 : 0, state.severity, summary, Date.now())
      this.lastWritten.set(signal, fingerprint)
      this.hasWarned = false
    } catch (error) {
      this.warnOnce(`PagerDuty signal ${signal} was not written: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Close the connection. Call on Homebridge `shutdown`. Never clears a signal. */
  close(): void {
    this.db?.close()
    this.db = undefined
  }

  private open(): Sqlite.DatabaseSync {
    // Loaded here, not imported at the top, so the plugin still loads on a
    // Node version without node:sqlite.
    const sqlite = typeof process.getBuiltinModule === 'function'
      ? process.getBuiltinModule('node:sqlite') as typeof Sqlite | undefined
      : undefined
    if (sqlite === undefined) {
      this.disable('PagerDuty signals need Node 22.13 or later; not writing signals')
    }
    const dir = join(this.options.storagePath, STORE_DIR, INTERFACE_ID)
    const file = join(dir, STORE_FILE)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    closeSync(openSync(file, 'a', 0o600))
    const db = new sqlite.DatabaseSync(file)
    try {
      db.exec('PRAGMA busy_timeout = 1000')
      db.exec(SCHEMA)
    } catch (error) {
      db.close()
      throw error
    }
    this.db = db
    return db
  }

  private disable(message: string): never {
    this.isDisabled = true
    this.hasWarned = false
    this.warnOnce(message)
    throw new Error(message)
  }

  private warnOnce(message: string): void {
    if (!this.hasWarned) {
      this.hasWarned = true
      this.options.log.warn(message)
    }
  }
}
```

What the module handles for you:

- **It opens the store on the first write,** so a plugin with the setting off never creates the file.
- **It skips a write when nothing changed** since the last write of that signal. Call `write` freely, for example on every device update.
- **It never throws.** A failed write logs one `warn` and is tried again at the next change.
- **It turns itself off,** with one `warn`, on a Node version without `node:sqlite`.
- **It cleans the summary.** Control characters such as newlines become spaces, and the summary is capped at 1024 characters.

In TypeScript, the `node:sqlite` types come from `@types/node` 22.13 or later. If the plugin's `@types/node` is older, raise it in `devDependencies` only.

## Setting

Add a boolean to `config.schema.json`, off by default:

```json
"pagerdutySignals": {
  "title": "Send Signals to PagerDuty",
  "type": "boolean",
  "default": false,
  "description": "Write this plugin's alert conditions to homebridge-pagerduty's signal store. Then allow homebridge-example to page in homebridge-pagerduty's settings. Needs Node 22.13 or later."
}
```

Add it to the plugin's config type as an optional boolean, and treat a missing value as `false`.

**If `config.schema.json` has a `layout` array, add `pagerdutySignals` to the layout too.** Homebridge's settings screen shows only the fields that the layout lists. A setting that is missing from the layout still saves and loads, but users never see it, and no test catches that. Put it in the section that holds the plugin's other optional settings, for example:

```json
{
  "type": "fieldset",
  "title": "Advanced",
  "expandable": true,
  "items": ["pagerdutySignals"]
}
```

If that section already exists, add `"pagerdutySignals"` to its `items` rather than creating a second one. Without a `layout` array, the setting appears on its own, and nothing else is needed.

## Wiring

Adapt this to the plugin's structure. The parts that matter are when `write` and `close` are called.

```ts
import { PagerDutySignals } from './pagerduty-signals'

// In the platform constructor:
this.signals = config.pagerdutySignals === true
  ? new PagerDutySignals({ plugin: 'homebridge-example', storagePath: api.user.storagePath(), log })
  : undefined

api.on('didFinishLaunching', () => {
  // After the plugin knows the current state of every condition,
  // write each signal once, active or not.
  this.signals?.write('sump-high', { active: sumpIsHigh, severity: 'error', summary: 'Sump water level is high' })
})

// Wherever the plugin learns that a condition changed:
this.signals?.write('sump-high', { active: sumpIsHigh, severity: 'error', summary: 'Sump water level is high' })

api.on('shutdown', () => {
  this.signals?.close()
})
```

- If the plugin learns the state of its devices later than `didFinishLaunching`, for example after its first poll of a cloud service, write each signal as soon as its state is known.
- If a condition can change faster than once per second, write only its latest state at most once per second.
- For a condition that belongs to one device, include the device in the signal name, such as `sump-high.basement`. Keep the name stable for as long as the device exists.

### Startup log

When the setting is on, log one `info` line at startup, once per process:

```text
homebridge-pagerduty support is enabled (sump-high, hub-offline)
```

- Use that sentence. Put this plugin's signal names in the parentheses, in a fixed order, separated by a comma and a space.
- For a signal whose name includes a device, log the pattern once, such as `sump-high.<device>`. Do not log one name per device: a device name belongs to the user, and this line gets copied into logs and issue reports.
- Log it with the plugin's other startup lines, and before the first operation that can fail, so the line still appears when startup then fails.
- Do not log it when the setting is off, and do not log it again when startup retries.
- On a Node version without `node:sqlite`, still log the line. The module's warning comes later, on the first write.

## Tests

Use the plugin's test framework. Run each test against a real SQLite file in a temporary directory, and skip the tests that need `node:sqlite` on a Node version without it.

1. A write creates `homebridge-pagerduty/` and `homebridge-pagerduty/signals-2026-10-24/` with mode `0700`, and `signals-2026-10-24/signals.sqlite` with mode `0600`.
2. A row read back through a separate `DatabaseSync` connection has the expected `plugin`, `signal`, `active`, `severity` and `summary`.
3. Writing the same state twice does not change `updated_at`.
4. A summary with a newline is stored with a space in its place.
5. With `process.getBuiltinModule` replaced by a function that returns `undefined`, nothing is created, and the plugin logs exactly one `warn`.
6. With the setting off, no directory or file is created.
7. The plugin calls `write` for every signal at startup, and `close` on shutdown.
8. With the setting on, startup logs `homebridge-pagerduty support is enabled` once, and the line names every signal. With the setting off, it does not log that line. A retried startup does not log it again.

## README section

Add this to the plugin's README, with the real signals in the table:

```markdown
## PagerDuty

This plugin can page through [homebridge-pagerduty](https://github.com/tbaur/homebridge-pagerduty) when something needs attention. It needs Node 22.13 or later.

1. Turn on **Send Signals to PagerDuty** (`pagerdutySignals`) in this plugin's settings.
2. Restart Homebridge.
3. In homebridge-pagerduty's settings, allow homebridge-example to page, save, and restart Homebridge again. [Signals from other plugins](https://github.com/tbaur/homebridge-pagerduty/blob/main/docs/SIGNALS.md#let-a-plugin-page) explains each step and what else you can set for each signal.

Each condition below then opens a PagerDuty alert while it is present, and resolves it when it clears.

| Signal | Severity | Active when |
| --- | --- | --- |
| `sump-high` | error | The sump water level is above the alarm line |
```

## Done when

- [ ] The setting exists, is off by default, and nothing touches the store while it is off.
- [ ] The setting shows in Homebridge's settings screen. If `config.schema.json` has a `layout` array, `pagerdutySignals` is listed in it.
- [ ] The module is copied unchanged, and `node:sqlite` is not imported anywhere else.
- [ ] Every signal is written once at startup, and again whenever it changes.
- [ ] With the setting on, startup logs `homebridge-pagerduty support is enabled` once, with every signal named, before the first operation that can fail. With the setting off, it does not log that line.
- [ ] `close` is called on shutdown, and no signal is cleared there.
- [ ] The tests above pass, and the plugin's existing tests and lint still pass.
- [ ] The README section lists every signal, with its name, its severity and when it is active.
