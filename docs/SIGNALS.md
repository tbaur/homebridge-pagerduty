# Signal store

The signal store lets another Homebridge plugin page through this one. The other plugin writes one row for each condition it watches, such as "sump water is high", to a small SQLite file. This plugin reads the file and turns each row into a PagerDuty alert. No Apple Home automation is needed.

- **You use PagerDuty with Homebridge:** read [For users](#for-users). It explains how to let a plugin page you, and what happens when it does.
- **You write a Homebridge plugin and want it to page people:** read [For plugin developers](#for-plugin-developers). It has the file location, the table definition, the rules and code that you can copy.
- **You want a coding agent to add signal support to your plugin:** point it at [SIGNALS-AGENT.md](SIGNALS-AGENT.md). That file has everything an agent needs, including a tested module to copy.

## For users

### Let a plugin page

This plugin ignores every other plugin until you list it. To list one:

1. In the Homebridge UI, open this plugin's settings.
2. Under **Other Plugins**, add the other plugin's npm package name to **Signal Sources**, for example `homebridge-example`. In `config.json`, this is the `signals.sources` list.
3. Save, then restart Homebridge.

The other plugin's documentation gives its package name. If a plugin writes to the store before you list it, this plugin logs its name once after each restart:

```text
signal store: homebridge-example writes signals but is not in signals.sources; ignored
```

While Signal Sources is empty, the plugin never opens the store.

### What happens once a plugin is listed

Each condition that the plugin reports becomes its own PagerDuty alert. The other plugin chooses the alert's title and severity. These alerts have no HomeKit switch.

- When the condition clears, the alert resolves.
- While the maintenance switch is on, these alerts are held like any other new page. If the condition is still present when maintenance ends, the alert is sent then.
- If you remove a plugin from Signal Sources, its open alerts resolve.

### Give a condition its own switch

You can tie a condition to an alert that you configure. The alert's switch then follows the condition, and you choose the name, the title and whether it pages during maintenance.

1. List the package in Signal Sources, as described above. The settings screen shows the **Follow Signal** field only after that.
2. Add an alert with exactly one level.
3. Set its **Follow Signal** field to `<package>/<signal>`, for example `homebridge-example/sump-high`. The other plugin's documentation lists its signal names.

If the package is not in Signal Sources, the plugin logs a `warn` at startup and the alert does not follow the signal.

An alert set up this way is called a bound alert. [Bound alerts](#bound-alerts) describes exactly how it behaves.

### What the list protects against

Signal Sources is about consent. It stops a plugin from paging your on-call people unless you asked it to. It does not stop harmful code: any program that runs as the Homebridge user can write to the store under any package name. That program could also read your integration key from `config.json`. List only plugins that you trust. See [Security](#security).

## For plugin developers

### What your plugin does

1. Open the store file at a fixed path in the Homebridge storage directory.
2. Create the table with the exact SQL below, and check the interface version.
3. Write one row for each condition: once at startup, then whenever the condition changes.
4. Tell your users to add your package name to this plugin's `signals.sources` setting. Until they do, this plugin ignores your rows.

[SIGNALS-AGENT.md](SIGNALS-AGENT.md) has a ready TypeScript module that does all of this, with the wiring, tests and README text to go with it. It is written for coding agents, and works just as well for people.

Your plugin does not need to know whether `homebridge-pagerduty` is installed. Writing to the store is safe either way. Do not add a dependency on this package. Copy the code on this page instead.

`node:sqlite` needs Node 22.13 or later. On Node 22, it prints an `ExperimentalWarning` the first time it loads. The warning comes from Node, not from the store.

### File location

```text
<storage>/homebridge-pagerduty/signals.sqlite
```

`<storage>` is `api.user.storagePath()`, the directory that holds `config.json`. Every child bridge on an install uses the same storage directory, so your plugin can reach the file from any bridge. The path will not change within interface version 1.

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
| `summary` | The alert title in PagerDuty, 1 to 1024 characters. |
| `updated_at` | The time of this write, in Unix milliseconds. PagerDuty shows it as the time that the condition changed. |

The `CHECK` constraints reject a bad value at the moment you write it. The error appears in your plugin, close to the bug.

### Interface version

`PRAGMA user_version` holds the interface version. It is currently `1`.

| You read | What it means | What to do |
|---|---|---|
| `0` | The store is new. | Set it to `1`. |
| `1` | This interface. | Write as normal. |
| Higher than `1` | A newer interface created the store. | Do not write. Log that your plugin needs an update. |

### Rules

1. **Open the store the same way every time:**
   1. Create the directory owner-only: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })`.
   2. Create the file owner-only: `fs.closeSync(fs.openSync(file, 'a', 0o600))`.
   3. Open the file read-write, and set `PRAGMA busy_timeout` to 1000 ms or less.
   4. Run the table definition.
   5. Check the interface version.

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
  const dir = path.join(storageDir, 'homebridge-pagerduty')
  const file = path.join(dir, 'signals.sqlite')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const db = new sqlite.DatabaseSync(file)
  try {
    db.exec('PRAGMA busy_timeout = 1000')
    db.exec(SCHEMA)
    const version = Number(db.prepare('PRAGMA user_version').get().user_version)
    if (version === 0) {
      db.exec('PRAGMA user_version = 1')
    } else if (version > 1) {
      throw new Error(`signal store is interface version ${version}; not writing`)
    }
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

Against a test Homebridge install, first add `homebridge-example` to Signal Sources. Then:

```bash
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --severity warning --summary "Door open"
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --clear
```

The first command opens an alert, and the second resolves it.

### How this plugin reads your rows

- **Every 2 seconds,** it checks whether the file changed. It reads rows only when something did.
- **It reads only rows from listed plugins,** up to 1000, newest first. Rows from unlisted plugins cannot crowd yours out of the read.
- **Only a change to `active` or `severity` sends anything.** A new `updated_at` on its own does not.
- **A row that fails validation is ignored,** with a `debug` log line.
- **A read error never resolves an alert.** If the file is missing, locked or damaged, the last rows read stay in force. The plugin logs a `warn` at most once an hour, and its delivery sensor opens after 5 minutes.
- **A replaced file is noticed.** The plugin checks the file's device and inode numbers on every poll, and reopens the file when they change.
- **Your values are escaped and length-capped** before they reach a log line.

### What PagerDuty receives

For a row that is not tied to a configured alert:

| Event field | Value |
|---|---|
| `dedup_key` | `<source>/<plugin>/<signal>`. `<source>` is the user's `source` setting, `homebridge` by default. |
| `payload.summary` | Your `summary` |
| `payload.severity` | Your `severity` |
| `payload.timestamp` | Your `updated_at`. If it is in the future, the time that the plugin read the row. |
| `payload.component` | Your `signal` |
| `payload.group` | Your `plugin` |
| `payload.custom_details.origin` | `signal` |

When `active` goes from `1` to `0`, the plugin sends a `resolve` with the same `dedup_key`. [EVENTS-API.md](EVENTS-API.md) shows a complete event.

### Bound alerts

A user can tie one of their configured alerts to your signal with `"signal": "<plugin>/<signal>"`. The alert's switch then follows your row. Whichever changed last wins:

- When your row changes, the switch turns on or off to match, and the alert takes your row's severity.
- A person can still flip the switch. That sends a `trigger` or `resolve` as usual, and the switch keeps that position until your row next changes. Turning the switch off while your row stays active silences the page.
- The severity is always the one from the last row seen, even when a person turns the switch on. The configured level's severity applies only until the first row is seen.
- The alert title is the user's configured `summary`, so it stays the same. Your row's `summary` goes into `custom_details.detail`.
- A bound alert can have `bypassMaintenance`. That is the only way for a signal to page while the maintenance switch is on.

## Security

**Signal Sources is not authentication.** Any process that runs as the Homebridge user can write any `plugin` value. The list stops a well-behaved plugin from paging people who never asked it to. It does not stop harmful code, and it does not need to: code that runs as that user can already read `config.json` and the integration key in it.

The plugin creates the `homebridge-pagerduty` directory owner-only (`0700`). It creates the store and its `-wal` and `-shm` files owner-only (`0600`). If it finds them with looser permissions, it tightens them and logs that.
