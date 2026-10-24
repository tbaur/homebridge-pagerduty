# Signal store

The signal store lets another Homebridge plugin page through this one. The other plugin writes one row for each condition it watches, such as "sump water is high", to a small SQLite file. This plugin reads the file and turns each row into a PagerDuty alert. No Apple Home automation is needed, and the settings screen lists each plugin and its signals by itself.

- **You use PagerDuty with Homebridge:** read [For users](#for-users). It explains how to let a plugin page you, what you can change for each signal, and what happens when it pages.
- **You write a Homebridge plugin and want it to page people:** read [For plugin developers](#for-plugin-developers). It has the file location, the table definition, the rules and code that you can copy.
- **You want a coding agent to add signal support to your plugin:** point it at [SIGNALS-AGENT.md](SIGNALS-AGENT.md). That file has everything an agent needs, including a tested module to copy.

## For users

### Let a plugin page

Plugins that support homebridge-pagerduty appear on this plugin's settings screen by themselves. This plugin ignores every one of them until you allow it.

1. Turn on PagerDuty support in the other plugin, as its documentation describes, and restart Homebridge.
2. In the Homebridge UI, open this plugin's settings. Under **Plugin Signals**, each plugin that has written to the store has its own section, with one entry for each of its signals.
3. Check **Allow this plugin to page**, look over each signal's settings, then save and restart Homebridge.

A plugin appears only after it has written to the store and this plugin has started since then. Until you allow it, this plugin logs its name once after each restart:

```text
signal store: homebridge-example writes signals; allow it under Plugin Signals to page for it
```

### Settings for each signal

| Setting | What it does |
|---|---|
| **Page for this signal** | On by default. Turn it off to stop this one signal from paging. |
| **PagerDuty Message** | The text sent to PagerDuty when the plugin raises this signal. It starts as the plugin's own text, and you can change it. Leave it blank to use whatever text the plugin writes. |
| **Severity** | **Set by the plugin** by default. Pick a severity to always page at that level instead. |
| **Page During Maintenance** | Page even while the maintenance switch is on. Shown only when the maintenance switch is turned on. |
| **Create HomeKit Switch** | Adds a switch to HomeKit for this signal. See [Signal switches](#signal-switches). |
| **Switch Name** | The name that HomeKit shows. Shown only when Create HomeKit Switch is checked. You can rename it at any time, and it keeps its room and automations. |

In `config.json`, these settings sit under `signals`, keyed by package name. A scoped package such as `@scope/homebridge-x` is stored as `@scope:homebridge-x`, because the settings screen cannot handle a `/` in a key.

```json
"signals": {
  "homebridge-example": {
    "allow": true,
    "signals": {
      "cloud-offline": { "enabled": true, "summary": "Example cloud is down", "severity": "plugin", "bypassMaintenance": true, "switch": true, "switchName": "Example Cloud" }
    }
  }
}
```

A signal that an allowed plugin starts writing after you saved the settings pages with the defaults, as if you had left every setting alone.

### What happens once a plugin is allowed

- While a signal is active, its PagerDuty alert is open. When it clears, the alert resolves.
- While the maintenance switch is on, new pages are held unless the signal has Page During Maintenance. If the signal is still active when maintenance ends, the page is sent then.
- If you turn off Page for this signal, or uncheck Allow this plugin to page, anything it had open resolves.

### Signal switches

A signal switch shows the signal in the Home app, and lets you test it.

- The switch is on while the signal is active, and turns off when it clears.
- Turning the switch on by hand pages with the signal's settings. Turning it off resolves the alert. If the plugin has not written the signal yet and its severity is left to the plugin, a page by hand is sent as `critical`.
- Whichever changed last wins. A person can flip the switch, and it stays that way until the plugin next changes the signal.

### What allowing a plugin protects against

Allow this plugin to page is about consent. It stops a plugin from paging your on-call people unless you asked it to. It does not stop harmful code: any program that runs as the Homebridge user can write to the store under any package name. That program could also read your integration key from `config.json`. Allow only plugins that you trust. See [Security](#security).

## For plugin developers

### What your plugin does

1. Open the store file at a fixed path in the Homebridge storage directory.
2. Create the table with the exact SQL below.
3. Write one row for each condition: once at startup, then whenever the condition changes.
4. Tell your users to check **Allow this plugin to page** for your plugin under **Plugin Signals** in this plugin's settings. Until they do, this plugin ignores your rows.

[SIGNALS-AGENT.md](SIGNALS-AGENT.md) has a ready TypeScript module that does all of this, with the wiring, tests and README text to go with it. It is written for coding agents, and works just as well for people.

Your plugin does not need to know whether `homebridge-pagerduty` is installed. Writing to the store is safe either way. Do not add a dependency on this package. Copy the code on this page instead.

`node:sqlite` needs Node 22.13 or later. On Node 22, it prints an `ExperimentalWarning` the first time it loads. The warning comes from Node, not from the store.

### File location

```text
<storage>/homebridge-pagerduty/signals-2026-10-24/signals.sqlite
```

`<storage>` is `api.user.storagePath()`, the directory that holds `config.json`. Every child bridge on an install uses the same storage directory, so your plugin can reach the file from any bridge. `signals-2026-10-24` is the interface identifier. See [Interface identifier](#interface-identifier).

homebridge-pagerduty 1.x read `<storage>/homebridge-pagerduty/signals.sqlite`. Version 2 does not read that file. At startup it logs a `warn` that names each plugin that still writes there and nowhere else.

Keep the store on a local disk. SQLite's WAL mode does not work on network filesystems.

### Table definition

Run this text, exactly as written, every time you open the store:

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

Do not change it. `CREATE TABLE IF NOT EXISTS` lets the first process that runs it define the table, and every other process then has to use that table. A changed copy could break the store for every plugin on the install.

| Column | What to write |
|---|---|
| `plugin` | Your npm package name, scoped or not. |
| `signal` | Your name for the condition, such as `sump-high`. Lowercase letters, digits, dot, underscore and hyphen, up to 64 characters. |
| `active` | `1` while the condition is present. `0` once it has cleared. |
| `severity` | `info`, `warning`, `error` or `critical`, in lowercase. If the PagerDuty service uses alert severity to set urgency, `critical` and `error` are high urgency, and `warning` and `info` are low. |
| `summary` | The alert title in PagerDuty, 1 to 1024 characters, on one line. homebridge-pagerduty replaces control characters, such as newlines, with a space. Users also see it as the starting value of their PagerDuty Message setting, so write text that still reads well if it is saved as a fixed message. |
| `updated_at` | The time of this write, in Unix milliseconds. PagerDuty shows it as the time that the condition changed. |

The `CHECK` constraints reject a bad value at the moment you write it. The error appears in your plugin, close to the bug.

### Interface identifier

The directory that holds the store names its interface: the path, the table definition, and the rules on this page. The current identifier is `signals-2026-10-24`, the date that this interface was defined. The identifier is separate from homebridge-pagerduty's version number, so it does not change with a release.

What homebridge-pagerduty promises:

- **A new identifier only for a breaking change.** That means a change that a writer built for the current identifier would get wrong. Several major versions in a row can use the same identifier.
- **Old identifiers keep working until a major version.** If a minor release introduces a new identifier, it reads both the old and the new one, and so does every later release with the same major version. Only a later major version stops reading the old one. Its release notes say so, and at startup it logs a `warn` that names each plugin still writing there.
- **Within one identifier, nothing that you rely on changes.** homebridge-pagerduty may accept more than it did before. It may also add a column that has a default value, which your plugin can ignore. It never needs a change from your plugin.

What your plugin does:

- **Write to one identifier,** the one in the code that you copied. Do not look for other directories, and do not write to two at once. When you move to a new identifier, stop writing to the old one in the same release.
- **Name the columns in every `INSERT`,** as the code below does, so that a column added later does not break your writes.
- **Never alter, drop or rebuild the table,** and never touch rows from other plugins.
- **Do not read or set `PRAGMA user_version`.** The directory names the interface.

### Rules

1. **Open the store the same way every time:**
   1. Create the directory owner-only: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })`.
   2. Create the file owner-only: `fs.closeSync(fs.openSync(file, 'a', 0o600))`.
   3. Open the file read-write, and set `PRAGMA busy_timeout` to 1000 ms or less.
   4. Run the table definition.

   Keep the busy timeout short. `node:sqlite` is synchronous, so while it waits for a lock, your whole bridge process waits too.
2. **Open the store once and keep the connection.**
3. **Write only rows whose `plugin` is your own package name.**
4. **At startup, write the current state of every signal you own,** whether it is active or not. That clears any condition that ended while Homebridge was down.
5. **When a condition changes, insert or update its row,** and set `updated_at` on every write.
6. **To clear a condition, write `active = 0`.** Deleting the row also clears it.
7. **Write when something changes, not on a timer,** and at most once per second for each signal.

### Code to copy

[`scripts/reference-writer.js`](../scripts/reference-writer.js) is a complete writer that you can run, with no dependencies. This is its core:

```js
const fs = require('node:fs')
const path = require('node:path')

// The whole table definition above, unchanged, including the PRAGMA line.
const SCHEMA = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS signals (
  ...
) STRICT;`

function openStore(storageDir) {
  // Loaded here, not at the top of the file, so the plugin still loads on a
  // Node version without node:sqlite.
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  if (sqlite === undefined) {
    throw new Error('the signal store needs Node 22.13 or later')
  }
  const dir = path.join(storageDir, 'homebridge-pagerduty', 'signals-2026-10-24')
  const file = path.join(dir, 'signals.sqlite')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const db = new sqlite.DatabaseSync(file)
  try {
    db.exec('PRAGMA busy_timeout = 1000')
    db.exec(SCHEMA)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function writeSignal(db, { plugin, signal, active, severity, summary }) {
  db.prepare(
    'INSERT INTO signals (plugin, signal, active, severity, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT (plugin, signal) DO UPDATE SET active = excluded.active, severity = excluded.severity, '
    + 'summary = excluded.summary, updated_at = excluded.updated_at',
  ).run(plugin, signal, active ? 1 : 0, severity, summary, Date.now())
}
```

In a plugin, pass `api.user.storagePath()` as `storageDir`. The reference writer has the full `SCHEMA` text, ready to copy.

### Try it from a terminal

Against a test Homebridge install, run the first command once and restart Homebridge, so that `homebridge-example` appears under Plugin Signals. Allow it, save, and restart again. Then:

```bash
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --severity warning --summary "Door open"
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --clear
```

The first command opens an alert, and the second resolves it.

### How this plugin reads your rows

- **Every 2 seconds,** it checks whether the file changed. It reads rows only when something did.
- **It reads only rows from allowed plugins,** up to 1000, newest first. Rows from other plugins cannot crowd yours out of the read.
- **It also reads the names and summaries of every plugin's signals,** for the settings screen. That text is only ever a field's starting value.
- **Only a change to `active` or `severity` sends anything.** A new `updated_at` on its own does not.
- **A row that fails validation is ignored,** with a `debug` log line.
- **A read error never resolves an alert.** If the file is missing, locked or damaged, the last rows read stay in force. The plugin logs a `warn` at most once an hour, and its delivery sensor opens after 5 minutes.
- **A replaced file is noticed.** The plugin checks the file's device and inode numbers on every poll, and reopens the file when they change.
- **Your values are escaped and length-capped** before they reach a log line.

### What PagerDuty receives

With the user's settings left alone:

| Event field | Value |
|---|---|
| `dedup_key` | `<source>/<plugin>/<signal>`. `<source>` is the user's `source` setting, `homebridge` by default. |
| `payload.summary` | Your `summary`, with each run of control characters replaced by a space |
| `payload.severity` | Your `severity` |
| `payload.timestamp` | Your `updated_at`. If it is in the future, the time that the plugin read the row. |
| `payload.component` | Your `signal` |
| `payload.group` | Your `plugin` |
| `payload.custom_details.origin` | `signal` |

When `active` goes from `1` to `0`, the plugin sends a `resolve` with the same `dedup_key`. [EVENTS-API.md](EVENTS-API.md) shows a complete event.

### What the user can change

The user can change the title and severity of each signal, let it page during maintenance, mute it, or give it a HomeKit switch. See [Settings for each signal](#settings-for-each-signal). When the user sets their own title, your `summary` goes into `custom_details.detail` whenever it differs from that title. The `dedup_key` stays the same whatever the user changes.

## Security

**Allowing a plugin is not authentication.** Any process that runs as the Homebridge user can write any `plugin` value. The setting stops a well-behaved plugin from paging people who never asked it to. It does not stop harmful code, and it does not need to: code that runs as that user can already read `config.json` and the integration key in it.

The plugin creates the `homebridge-pagerduty` directory, and the interface directory inside it, owner-only (`0700`). It creates the store and its `-wal` and `-shm` files owner-only (`0600`). If it finds them with looser permissions, it tightens them and logs that.
