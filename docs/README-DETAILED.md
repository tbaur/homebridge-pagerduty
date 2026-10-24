# homebridge-pagerduty: detailed documentation

The [README](../README.md) covers installation and setup. This page covers everything else.

## Table of Contents

- [Scope](#scope)
- [Accessories in detail](#accessories-in-detail)
- [How alerts behave](#how-alerts-behave)
- [Reliability in detail](#reliability-in-detail)
- [Full configuration reference](#full-configuration-reference)
- [Accessory identity](#accessory-identity)
- [Reading the log](#reading-the-log)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Quality](#quality)
- [More](#more)

## Scope

The plugin turns HomeKit state into PagerDuty alerts. It sends `trigger` and `resolve` to the Events API v2, and nothing else.

It does not:

- acknowledge incidents, or read anything from PagerDuty, so a switch never moves because of something that happened in PagerDuty
- send change events, images or links
- change PagerDuty service settings such as auto-resolve or dynamic notifications
- detect that Homebridge itself is down. That needs a monitor outside the install
- detect a deleted or revoked integration key, because PagerDuty answers as if the event was accepted

## Accessories in detail

Every accessory reports Manufacturer `homebridge-pagerduty`, a model name, a serial number generated once and kept, and the plugin version as Firmware.

### Alert switches

Model `Alert Switch`. One `Switch` accessory per level of each configured alert.

On means "this condition is present". A write updates the plugin's saved state and returns at once. Sending to PagerDuty happens afterwards, so a slow or failing PagerDuty never shows as an error in the Home app.

Each level is its own accessory with its own tile.

### Maintenance switch

Model `Maintenance Switch`. Added when `maintenance.switch` is true, and named `PagerDuty Maintenance` unless `maintenance.name` says otherwise. See [Maintenance](#maintenance).

### Delivery sensor

Model `Delivery Sensor`. A `ContactSensor`, added unless `options.deliveryFaultSensor` is false, and named `PagerDuty Delivery` unless `options.deliveryFaultSensorName` says otherwise. **Open means pages are not going out.** Create a Home app notification for it.

It opens when any of these is true, and closes when none is:

- An alert has needed sending for 2 minutes and has not been accepted. Alerts held by maintenance do not count.
- PagerDuty rejected an event, and the alert has not changed since.
- The signal store has been unreadable for 5 minutes.

Maintenance never opens it on its own. It cannot detect a deleted integration key, because PagerDuty accepts events sent to one.

## How alerts behave

### Alerts and levels

An alert has a stable `id`, a summary and one or more levels. Each level has a severity and is one switch. One alert is one PagerDuty alert.

- **Open:** an alert is open while any of its levels is on.
- **Severity:** the highest severity among the levels that are on.
- **Trigger:** sent when the alert should be open and either it is not open in PagerDuty, or its severity went up.
- **Resolve:** sent when no level is on and the alert is open in PagerDuty.
- **Lowering:** turning off a higher level while a lower one stays on sends nothing. PagerDuty does not lower an alert's severity, so the plugin does not try.

The order in which levels turn on does not matter.

### On while already on

Nothing is sent. To page again on purpose, turn the switch off and on.

A repeat On does restart the alert's resolve timer, if it has one.

### Resolve timer

`resolveAfterMinutes` on an alert, `0` for none. The timer starts when any level turns on and restarts on every On write. When it runs out, every level turns off and the alert resolves. Turning all levels off cancels it. The deadline is saved as a time of day, so it survives a restart, and a deadline that passed while Homebridge was down fires at startup.

### Maintenance

While the maintenance switch is on:

- New triggers and severity raises are held.
- Resolves are always sent.
- Alerts with `bypassMaintenance: true` are not held.
- Signals from other plugins are always held, unless they are tied to an alert with `bypassMaintenance: true`.

When maintenance ends, anything still active is sent. A condition that started and ended during maintenance sends nothing.

Maintenance turns itself off after `maintenance.maxMinutes` (default 240, at most 10080). Turning it on or off logs at `info`; turning itself off logs at `warn`. If you set `maintenance.switch` to false while maintenance is on, maintenance ends at the next start and the switch is removed.

### What the plugin does not track

PagerDuty state is never read. If a person resolves the incident while the switch stays on, nothing is sent until the switch changes. Turning the switch off and on then opens a new incident. The same applies when the service auto-resolves it. While an incident is acknowledged, PagerDuty notifies no one again, even when the severity goes up.

### Pages from other plugins

Another Homebridge plugin can page through this one by writing to the [signal store](SIGNALS.md). It can page only after you add its package name to `signals.sources` (**Signal Sources**, under **Other Plugins** in the settings). Its alerts have no switch unless you tie one of your alerts to it with the alert's **Follow Signal** field (`signal` in `config.json`). [SIGNALS.md](SIGNALS.md#for-users) explains both.

## Reliability in detail

For every alert, the plugin saves two things to disk: what should be true, based on the switches, signal rows, timers and maintenance, and what PagerDuty has accepted. One sender compares the two and sends whatever makes PagerDuty match, one request at a time.

- **Restart:** the next start picks up where the last one stopped. An unsent resolve is sent then.
- **Outage:** nothing is queued. When PagerDuty answers again, the plugin sends the current state. The recovery line counts alerts that opened and closed while PagerDuty was unreachable and were never sent.
- **Only an accepted event counts:** an alert is recorded as open in PagerDuty only after PagerDuty accepts it. What is recorded is what was sent, so a severity raised while a request was in flight is still sent afterwards.
- **Rejected events:** PagerDuty's reason is logged, the delivery sensor opens, and the same event is not sent again. The alert is retried once it changes, after an upgrade, or after the key, region or source changes.
- **Retries:** network errors and server errors retry after 5 seconds, doubling to 5 minutes, with random jitter. Rate limits wait at least 30 seconds, doubling to 5 minutes, and honor `Retry-After` up to 15 minutes. [EVENTS-API.md](EVENTS-API.md#status-handling) has the detail.
- **A lost state file:** if the state file cannot be parsed, it is moved aside, and the plugin sends a resolve for every alert that should be closed. A resolve for an alert that is not open is harmless. Any other read error, such as a permission problem, stops the platform instead, so the problem is visible.
- **An invalid alert entry is held.** Its switch, its saved state and any open PagerDuty alert stay exactly as they were until the entry is fixed. A typo in a summary cannot resolve a live incident or delete a tile.
- **A removed alert** (its `id` is gone from the config) is resolved if it was open, and its switches are removed.
- **A changed integration key:** PagerDuty ignores a resolve sent on a different key. The plugin names each alert that was open on the old key in one `warn` so you can resolve it by hand, then sends anything still active on the new key. The state file stores only a one-way fingerprint of the key.

Files written: everything goes in one `homebridge-pagerduty` directory inside the Homebridge storage directory, readable only by its owner. It holds `state.json` and, when signal sources are set, `signals.sqlite` with its `-wal` and `-shm` files. The state file is replaced atomically on every change. Deleting the directory removes everything the plugin wrote; do that only with no alerts open, because the plugin then forgets what is open in PagerDuty.

## Full configuration reference

### Platform options

| Option | Default | Description |
| --- | --- | --- |
| `name` | `PagerDuty` | Name shown in Homebridge logs. Required by Homebridge |
| `routingKey` | | Events API v2 integration key, 32 letters and digits. Without it the plugin logs one line and starts nothing |
| `region` | `us` | `us` or `eu` |
| `source` | `homebridge` | Sent as the event source and used as the first part of every alert's key. 1–32 letters, digits, dot, underscore or hyphen. Two installs that share one integration key must use different values, or their alerts merge |
| `alerts` | `[]` | Up to 30 alerts. See [`alerts[]` entries](#alerts-entries) |
| `maintenance.switch` | `false` | Add the maintenance switch |
| `maintenance.name` | `PagerDuty Maintenance` | The maintenance switch's name in HomeKit, up to 64 characters |
| `maintenance.maxMinutes` | `240` | Maintenance turns itself off after this long, 15–10080 |
| `signals.sources` | `[]` | Package names allowed to raise alerts through the [signal store](SIGNALS.md). Empty keeps the store closed. `homebridge-pagerduty` itself is not allowed |
| `options.deliveryFaultSensor` | `true` | Add the delivery sensor |
| `options.deliveryFaultSensorName` | `PagerDuty Delivery` | The delivery sensor's name in HomeKit, up to 64 characters |
| `options.dryRun` | `false` | Log each event that would be sent and send nothing. Accepted state is kept in memory only |
| `options.diagnosticsInterval` | `0` | Seconds between health lines. `0` is off; 1–29 becomes 30; the maximum is 3600 |
| `options.structuredLogs` | `false` | With diagnostics, also log each report as one JSON line |

### `alerts[]` entries

| Field | Required | Description |
| --- | --- | --- |
| `id` | ✓ | Stable identifier: a lowercase letter, then up to 31 lowercase letters, digits or hyphens. Unique. Changing it creates a new alert and new switches |
| `name` | ✓ | Display name, up to 64 characters |
| `summary` | ✓ | The alert title in PagerDuty, 1–1024 characters |
| `levels` | ✓ | 1–4 levels, each with a different `severity` |
| `resolveAfterMinutes` | | Resolve automatically this many minutes after the last On, 0–10080. `0` (default) is never |
| `bypassMaintenance` | | Page even while maintenance is on (default false) |
| `signal` | | `<package>/<signal>`: the switch follows a signal that another plugin writes. The alert must have exactly one level, and the package must be in `signals.sources`. See [SIGNALS.md](SIGNALS.md#give-a-condition-its-own-switch) |

Each level takes:

| Field | Required | Description |
| --- | --- | --- |
| `severity` | ✓ | `info`, `warning`, `error` or `critical`. If the service uses alert severity to set urgency, `critical` and `error` are high urgency, and `warning` and `info` are low |
| `name` | | The switch name. Defaults to the alert name for a single level, and to `<alert name> <Severity>` otherwise |

**Severity is part of a switch's identity.** Changing it creates a new switch and removes the old one, along with its automations.

### A complete example

```json
{
  "platform": "PagerDuty",
  "name": "PagerDuty",
  "routingKey": "<your 32-character integration key>",
  "region": "us",
  "source": "homebridge",
  "alerts": [
    {
      "id": "leak",
      "name": "Leak",
      "summary": "Water leak detected",
      "levels": [{ "severity": "critical" }],
      "bypassMaintenance": true
    },
    {
      "id": "freezer",
      "name": "Freezer",
      "summary": "Freezer temperature is high",
      "levels": [
        { "severity": "warning", "name": "Freezer Warm" },
        { "severity": "critical", "name": "Freezer Hot" }
      ]
    },
    {
      "id": "garage-door",
      "name": "Garage Door Open",
      "summary": "Garage door left open",
      "levels": [{ "severity": "warning" }],
      "resolveAfterMinutes": 60
    },
    {
      "id": "sump",
      "name": "Sump",
      "summary": "Sump level high",
      "levels": [{ "severity": "error" }],
      "signal": "homebridge-example/sump-high"
    }
  ],
  "maintenance": { "switch": true, "name": "PagerDuty Maintenance", "maxMinutes": 240 },
  "signals": { "sources": ["homebridge-example"] },
  "options": {
    "deliveryFaultSensor": true,
    "deliveryFaultSensorName": "PagerDuty Delivery",
    "dryRun": false,
    "diagnosticsInterval": 0,
    "structuredLogs": false
  }
}
```

### How a bad config is handled

- **No `routingKey`:** one `info` line, nothing started, cached accessories kept.
- **A config that cannot be used** (a malformed key, an invalid `source`, more than 30 alerts): the reasons are logged at `error`, the platform stops, and cached accessories are kept. They show No Response until it is fixed.
- **One bad alert entry with a usable `id`:** that alert is held (see [Reliability in detail](#reliability-in-detail)), with a `warn` that names the problem.
- **An entry with no usable `id`:** skipped with a `warn`.
- **A repeated `id`:** the second entry is skipped with a `warn`.
- **Out-of-range numbers:** clamped, with a `warn`.
- **An unusable maintenance switch or delivery sensor name** (too long, not text, or with control characters): the default name is used, with a `warn`.

## Accessory identity

A switch's identity is its alert `id` and its severity. The maintenance switch and the delivery sensor each have a fixed identity, whatever they are named. A display name never enters identity, so renaming keeps the room and the automations. The startup report notes each rename, for example `Alert switch: leak "Water leak detected" (critical; renamed Water Leak to Leak)`.

Cached accessories are adopted at startup, never recreated. Only removing an alert's `id` from the config removes its switches.

Only one `PagerDuty` platform is supported per Homebridge. A second block in the same process logs an error and disables itself. Running the plugin in two separate child bridges is not supported, because both would share one state file.

## Reading the log

| Line | Level | Meaning |
| --- | --- | --- |
| `Starting v1.1.0: region US, source homebridge, signal sources 2` | info | Startup has begun. `(dry run: nothing is sent)` follows the version in dry-run mode. The signal sources count appears when there are any |
| `Alert switch: freezer "Freezer temperature is high" (warning, critical)` | info | One line for each alert at startup: its `id`, its PagerDuty title and the severity of each level. `; new` joins the brackets when its switches were added on this start (or `; new Freezer Hot` when only some were), and `; renamed Freezer Warm to Freezer Cold` when a switch name changed in the config |
| `Maintenance switch: PagerDuty Maintenance; turns off after 240 min` | info | The maintenance switch, at startup. The delivery sensor gets a `Delivery sensor:` line. `(new)` follows the name when the accessory was added on this start, and `(renamed from ...)` when its name changed |
| `Platform ready` | info | Startup finished and everything is running. It follows the `Diagnostics start` line when diagnostics are on. If this line is missing, look for an `error` above it |
| `Freezer Warm: switched on` | info | A level changed |
| `Freezer: trigger sent (warning)` | info | PagerDuty accepted a trigger |
| `Freezer: resolve sent` | info | PagerDuty accepted a resolve |
| `Garage Door Open: resolve timer expired; switched off` | info | The resolve timer ran out |
| `maintenance on: new pages are held for up to 240 min; resolves still go out` | info | Maintenance started |
| `maintenance off: sending anything still active` | info | Maintenance ended |
| `maintenance turned itself off after 240 min; paging is back on` | warn | `maintenance.maxMinutes` ran out |
| `PagerDuty is not reachable (...); retrying in 5s` | warn | Network or server error. Repeated at most hourly |
| `PagerDuty is rate limiting events (HTTP 429); retrying in 45s` | warn | Rate limited |
| `PagerDuty recovered after 3 min` | info | Answering again. May add how many alerts opened and closed meanwhile |
| `Leak: PagerDuty rejected the trigger: ... Not retried until the alert changes` | warn | PagerDuty refused the event |
| `PagerDuty answered 200 rather than 202; treated as accepted` | warn | An undocumented success status |
| `pages are not going out; delivery sensor open` | warn | The delivery sensor opened |
| `pages are going out again; delivery sensor closed` | info | It closed |
| `alert garage-door is held until fixed (nothing is sent or removed): ...` | warn | An invalid alert entry |
| `the integration key changed while 1 alert(s) were open: ...` | warn | Resolve the named alerts in PagerDuty by hand |
| `state file was unreadable; moved aside and starting empty: ...` | warn | Followed by a resolve sweep |
| `sending resolve for 4 alert(s) the lost state file may have left open` | warn | The resolve sweep |
| `signal store unavailable (...); keeping the last rows read` | warn | A read error. Nothing is cleared |
| `signal store: homebridge-example writes signals but is not in signals.sources; ignored` | info | A plugin writes signals but is not in Signal Sources. Add it to let it page |
| `tightened /path/to/homebridge-pagerduty/signals.sqlite-wal to owner-only` | info | A store file had a looser mode |

Names and values that come from config or from other plugins are escaped and length-capped before they reach the log.

### Diagnostics (optional)

Set `options.diagnosticsInterval` to log a health line on a schedule:

```text
Health: healthy | open 1 | pending 0 | held 0 | store ok | api p50 120ms p95 300ms (req 3, err 0)
```

- `open`: alerts that PagerDuty has accepted as open.
- `pending`: alerts waiting to be sent.
- `held`: alerts held by maintenance.
- `store`: shown only when signal sources are set.
- `api`: request latency over the last 200 requests, and requests and errors since the previous line.

When health changes, the plugin logs a line such as `Health degraded: degraded [pagerDutyUnreachable]` at `warn`, or `Health recovered: healthy` at `info`. The reasons are `deliveryFault`, `pagerDutyUnreachable`, `eventRejected` and `signalStoreUnreadable`. A `Diagnostics start` and `Diagnostics stop` line include a summary of the configuration, with the integration key shown only as present or absent.

With `options.structuredLogs`, each report is also logged as one JSON line for log tooling.

## Troubleshooting

1. **The switch turns on but nothing appears in PagerDuty, and the log says `trigger sent`.** PagerDuty accepted the event. Check that the key belongs to an **Events API v2** integration on the service you are watching, that the integration and service are enabled, and that no PagerDuty maintenance window is active. PagerDuty accepts events for a deleted key without complaint.
2. **`no routingKey set; PagerDuty is not started`.** Add the integration key.
3. **`routingKey is not a 32-character PagerDuty integration key`.** Copy the **Integration Key** from the Events API v2 integration, not a REST API key or a service ID.
4. **`platform disabled; cached accessories kept`.** The lines before it say what is wrong. Your switches show No Response until it is fixed. Nothing has been removed.
5. **`alert <id> is held until fixed`.** One alert entry has a problem, and the line says what. That alert sends nothing and keeps its switch until you fix the entry.
6. **`PagerDuty rejected the trigger`.** PagerDuty refused the event, and the reason follows in the same line. The alert is tried again when it changes.
7. **`PagerDuty is not reachable` or `PagerDuty is rate limiting events`.** The plugin retries on its own, and logs one line when PagerDuty answers again.
8. **The delivery sensor is open.** Pages are not going out. The log shows a rejected event or an unreachable PagerDuty, or says that the signal store has been unreadable for 5 minutes.
9. **An EU account.** Set `region` to `eu`. PagerDuty forwards EU keys sent to the US host, but recommends the EU host.
10. **A switch disappeared.** Its alert `id` or level `severity` changed, which makes it a new switch. Names can change freely.
11. **An incident stays open after the switch turned off.** Check the log for `resolve sent`. If it is there, a PagerDuty maintenance window probably dropped the resolve, or the key changed since the trigger. Resolve the incident in PagerDuty.
12. **The severity went down in HomeKit but not in PagerDuty.** PagerDuty never lowers an alert's severity.
13. **No one was notified for a severity raise.** Either the incident was acknowledged, or both severities have the same urgency: `info` and `warning` are both low, and `error` and `critical` are both high.
14. **`the integration key changed while ... were open`.** Resolve the named alerts in PagerDuty. The plugin cannot.
15. **`saved state could not be loaded`.** The platform stopped rather than starting empty and losing track of open alerts. Check the permissions on the `homebridge-pagerduty` directory and the `state.json` inside it.
16. **A plugin writes signals but nothing pages.** Add its package name to `signals.sources`. The log names any plugin that writes signals but is not listed.
17. **`ExperimentalWarning: SQLite is an experimental feature`.** Node 22 prints this once when the signal store opens. It is harmless.
18. **`a second PagerDuty platform is configured`.** Remove the extra `PagerDuty` block from `config.json`.

To check the whole path from a terminal, without Homebridge, see [`scripts/README.md`](../scripts/README.md).

## Security

The integration key lives in the Homebridge config file, like every Homebridge credential. It is never written to the log, the diagnostics output or an accessory's cache, and only its SHA-256 fingerprint is saved in the state file. PagerDuty's error responses are redacted before they are logged. The only network destination is the PagerDuty Events host for your region, over HTTPS, with redirects refused.

Signal Sources is not authentication. See [SIGNALS.md](SIGNALS.md#security) and [SECURITY.md](../SECURITY.md).

## Quality

- Strict TypeScript with `noUncheckedIndexedAccess`, type-aware lint, and lint that fails on warnings
- A Jest suite with a 90% coverage gate on statements, branches, functions and lines
- The decision logic is a pure function, tested directly against every behavior on this page
- The signal store is tested against real SQLite files, including writes from a separate process and a file replaced while open
- The module in [SIGNALS-AGENT.md](SIGNALS-AGENT.md) is compiled and run against the reader in the test suite
- No runtime dependencies

## More

- [README](../README.md)
- [Features](FEATURES.md)
- [Signal store](SIGNALS.md)
- [Signal store for coding agents](SIGNALS-AGENT.md)
- [Events API reference](EVENTS-API.md)
- [Development](../DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-pagerduty/issues)
