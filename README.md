# homebridge-pagerduty

[![Tests](https://github.com/tbaur/homebridge-pagerduty/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-pagerduty/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-pagerduty?style=flat-square)](https://www.npmjs.com/package/homebridge-pagerduty)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-pagerduty?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-pagerduty)
[![Node.js](https://img.shields.io/badge/node-22.13%20%7C%7C%2024%20%7C%7C%2026-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-2.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Page someone through PagerDuty when something at home goes wrong.** Each alert you configure is a HomeKit switch. Turning it on opens a PagerDuty alert, and turning it off resolves it. A Home automation does the rest: a leak sensor trips, the `Leak` switch turns on, and whoever is on call gets paged.

Other Homebridge plugins on the same install can also raise alerts directly, through a small local [signal store](docs/SIGNALS.md), with no automation at all.

The plugin uses one PagerDuty interface, the [Events API v2](docs/EVENTS-API.md). It sends `trigger` and `resolve`, and it never reads anything back from PagerDuty.

## Features

### Per alert

- **A switch per severity level.** Most alerts have one level. An alert can have up to four, such as `Freezer Warm` at `warning` and `Freezer Hot` at `critical`. Both feed one PagerDuty alert, which is raised as the condition gets worse
- **Resolve timer:** for a condition with no natural end, the alert turns itself off and resolves after a set number of minutes
- **Bypass maintenance:** for alerts such as smoke, which should page during any work
- **Bound to a signal:** an alert's switch can follow a row that another plugin writes

### Per install

- **Maintenance switch:** holds new pages while someone works on the house, sends them afterwards if the condition is still present, and turns itself off after 4 hours by default. Resolves always go out
- **Delivery sensor:** a contact sensor that opens when pages are not going out, so the Home app can tell you that paging is broken
- **Signal store:** a SQLite file that other plugins write to, limited to the plugins you allow

### Reliability

- **Nothing is lost on restart.** What should be open and what PagerDuty has accepted are both saved to disk. After a restart, the plugin sends whatever closes the gap
- **Outages send the current state, not a backlog.** A condition that started and ended while PagerDuty was unreachable sends nothing, and the recovery line says so
- **HomeKit never waits on PagerDuty.** A switch responds at once, whatever PagerDuty is doing
- **A rejected event is not resent in a loop.** It is logged, the delivery sensor opens, and the alert is tried again once it changes
- **Rate limits are respected,** with a backoff of minutes and `Retry-After` honored
- **Severity is only ever raised.** PagerDuty cannot lower an alert's severity, so the plugin never tries
- **A broken config never removes a tile.** The platform stops and keeps your accessories, rooms and automations

### Quality

- **Strict TypeScript,** with `noUncheckedIndexedAccess` and type-aware lint
- **Tested:** a behavioral Jest suite with a 90% coverage gate, including real SQLite files and a writer in a separate process
- **No analytics:** the only network destination is your own PagerDuty Events endpoint
- **No runtime dependencies.** HTTPS and SQLite come from Node itself

Every accessory, setting and log line is documented in the [detailed documentation](docs/README-DETAILED.md).

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-pagerduty` → Install

```bash
npm install -g homebridge-pagerduty
```

### 2. Prepare PagerDuty

In PagerDuty, open the service that should receive the pages and add an integration of type **Events API v2**. Copy its **Integration Key**, a 32-character string.

Three service settings matter:

- **Let severity set urgency** if you want `warning` and `info` alerts to notify less loudly than `critical` and `error`. In the service's urgency settings, choose "Use alert severity to determine urgency". Otherwise every alert has the service's fixed urgency, whatever its severity.
- **Turn on auto-resolve** for the service. It closes an incident if Homebridge goes down while an alert is open and never sends the resolve.
- **Do not use PagerDuty maintenance windows on this service.** PagerDuty drops resolves during a window, so an incident stays open and keeps notifying. Use this plugin's maintenance switch instead.

### 3. Configure

**Homebridge UI** (recommended): open the plugin settings, paste the integration key, and add an alert for each condition that should page.

Or in `config.json`:

```json
{
  "platforms": [
    {
      "platform": "PagerDuty",
      "name": "PagerDuty",
      "routingKey": "<your 32-character integration key>",
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
        }
      ],
      "maintenance": { "switch": true }
    }
  ]
}
```

See the [full configuration reference](docs/README-DETAILED.md#full-configuration-reference) for every option.

### 4. Restart Homebridge, then test it

Each level appears as a switch. Turn one on in the Home app and check that the alert opens in PagerDuty, then turn it off and check that it resolves.

**Do this test.** PagerDuty accepts events sent to a deleted or disabled integration key and answers as if everything worked, so the plugin cannot detect a wrong key on its own.

### 5. Add automations

In the Home app, create an automation for each sensor: when the sensor detects the problem, turn the alert's switch on. Add a second automation that turns it off when the problem clears, or set `resolveAfterMinutes` on the alert.

## Configuration Options

Only one `PagerDuty` platform block is supported per Homebridge install.

| Option | Required to run | Description |
| --- | --- | --- |
| `name` | ✓ | Plugin instance name shown in Homebridge logs |
| `routingKey` | ✓ | The service's Events API v2 integration key. Without it the plugin does not start |
| `region` | | `us` (default) or `eu`, matching where your PagerDuty account lives |
| `source` | | Sent as the event source and used in every alert's key (default `homebridge`). Two installs that share one integration key must use different values |
| `alerts` | | Up to 30 alerts. Each needs `id`, `name`, `summary` and `levels` |
| `maintenance.switch` | | Add the maintenance switch (default false) |
| `maintenance.maxMinutes` | | Maintenance turns itself off after this many minutes, 15–10080 (default 240) |
| `signals.sources` | | Package names of plugins allowed to raise alerts through the signal store. Empty (default) keeps the store closed |
| `options.deliveryFaultSensor` | | Add the delivery sensor (default true) |
| `options.dryRun` | | Log each event that would be sent, and send nothing (default false) |
| `options.diagnosticsInterval` | | Seconds between health lines in the log; `0` is off (default), else `30`–`3600` |
| `options.structuredLogs` | | With diagnostics, also emit a JSON line (default false) |

Each alert takes `id`, `name`, `summary` and `levels`, plus optional `resolveAfterMinutes`, `bypassMaintenance` and `signal`. Each level takes a `severity` (`info`, `warning`, `error` or `critical`) and an optional `name`. The [detailed documentation](docs/README-DETAILED.md#alerts-entries) describes each one.

**Changing an alert's `id` or a level's `severity` creates a new switch.** The old switch, and any automation attached to it, is removed. Renaming is safe: a `name` change keeps the switch, its room and its automations.

## What the plugin does not track

The plugin never reads PagerDuty. If a person acknowledges or resolves an incident in PagerDuty, the switch does not move.

- If someone resolves the incident while the switch stays on, nothing more is sent until the switch changes. Turning it off and on opens a new incident.
- While an incident is acknowledged, PagerDuty notifies no one again, even when the plugin raises the severity.
- Turning the switch on while it is already on sends nothing. To page again on purpose, turn it off and on.

## Not Working?

1. **Nothing reaches PagerDuty and the log is quiet.** Check that the integration key is for an **Events API v2** integration on the right service. PagerDuty accepts events sent to a deleted key without saying so
2. **`no routingKey set; PagerDuty is not started`.** Add the integration key in the plugin settings
3. **`platform disabled; cached accessories kept`.** The configuration could not be used. The lines before it say why. Your switches show No Response until it is fixed
4. **`alert <id> is held until fixed`.** One alert entry has a problem. That alert sends nothing and keeps its switch until the entry is fixed
5. **`PagerDuty rejected the trigger`.** PagerDuty refused the event. The reason follows in the same line. The alert is tried again when it changes
6. **`PagerDuty is not reachable` or `is rate limiting events`.** The plugin retries on its own and logs once when PagerDuty answers again
7. **The delivery sensor is open.** One of the three lines above explains why

The [full troubleshooting list](docs/README-DETAILED.md#troubleshooting) covers more, including EU accounts and key changes.

## Security

The integration key is stored in the Homebridge configuration file, as every Homebridge credential is. Anyone who has it can page the people on call for that service, so treat it like a password. The plugin never writes it to the log, not even its length, and the state file keeps only a one-way fingerprint of it. [SECURITY.md](SECURITY.md) has the detail, including why the signal store's allowlist is not authentication.

## Requirements

- Homebridge 2.x
- Node.js 22.13 or later on 22, or Node.js 24 or 26. The signal store uses `node:sqlite`, which Node 22 marks experimental and announces with a one-time warning in the log
- A PagerDuty service with an Events API v2 integration
- A working internet connection

Running this plugin in two separate child bridges on one install is not supported.

## More Info

- [Detailed documentation](docs/README-DETAILED.md)
- [Features](docs/FEATURES.md)
- [Signal store](docs/SIGNALS.md): how another plugin raises an alert
- [Events API reference](docs/EVENTS-API.md): what PagerDuty actually does with each event
- [Development](DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-pagerduty/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
