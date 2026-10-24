# homebridge-pagerduty

[![Tests](https://github.com/tbaur/homebridge-pagerduty/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-pagerduty/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-pagerduty?style=flat-square)](https://www.npmjs.com/package/homebridge-pagerduty)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-pagerduty?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-pagerduty)
[![Node.js](https://img.shields.io/badge/node-22.13%20%7C%7C%2024%20%7C%7C%2026-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-2.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Page someone through PagerDuty when something at home goes wrong.** Each alert you configure is a HomeKit switch. Turning it on opens a PagerDuty alert, and turning it off resolves it. A Home automation does the rest: a leak sensor trips, the `Leak` switch turns on, and whoever is on call gets paged.

## Features

- **A switch for each alert.** An alert can have up to four severity levels, such as `Freezer Warm` at `warning` and `Freezer Hot` at `critical`. Each level is its own switch, and all of them feed one PagerDuty alert.
- **Maintenance switch.** Holds new pages while someone works on the house, and sends them afterwards if the condition is still present. Resolves always go out.
- **Delivery sensor.** A contact sensor that opens when pages are not going out, so the Home app can tell you that paging is broken.
- **Resolve timer,** for a condition with no natural end.
- **Pages from other plugins.** Another Homebridge plugin can page directly, with no automation, through a small local [signal store](docs/SIGNALS.md). Only plugins that you list can page.
- **Restarts and outages lose nothing.** After an outage, the plugin sends the current state, not a backlog.
- **No analytics and no runtime dependencies.** The only network destination is your PagerDuty service.

The [detailed documentation](docs/README-DETAILED.md) describes every accessory, setting and log line.

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-pagerduty` → Install

```bash
npm install -g homebridge-pagerduty
```

### 2. Prepare PagerDuty

In PagerDuty, open the service that should receive the pages and add an integration of type **Events API v2**. Copy its **Integration Key**, a 32-character string.

Three service settings matter:

- **Let severity set urgency** if you want `warning` and `info` alerts to notify less loudly than `critical` and `error`. In the service's urgency settings, choose "Use alert severity to determine urgency".
- **Turn on auto-resolve.** If Homebridge goes down while an alert is open, the resolve never arrives, and auto-resolve closes the incident.
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
          "levels": [{ "severity": "critical" }]
        }
      ]
    }
  ]
}
```

Choose each alert's `id` once and keep it. Changing an `id`, or a level's `severity`, creates a new switch, and the old switch is removed with its automations. A `name` can change at any time. The [configuration reference](docs/README-DETAILED.md#full-configuration-reference) lists every option.

### 4. Restart Homebridge, then test it

Each level appears as a switch. Turn one on in the Home app and check that the alert opens in PagerDuty. Then turn it off and check that the alert resolves.

**Do this test.** PagerDuty accepts events sent to a deleted or disabled integration key and answers as if everything worked, so the plugin cannot detect a wrong key on its own.

### 5. Add automations

In the Home app, create an automation for each sensor: when the sensor detects the problem, turn the alert's switch on. Add a second automation that turns the switch off when the problem clears, or set `resolveAfterMinutes` on the alert.

## Good to know

- **The plugin never reads PagerDuty.** If someone acknowledges or resolves an incident in PagerDuty, the switch does not move.
- **Turning on a switch that is already on sends nothing.** To page again on purpose, turn it off and on.
- **PagerDuty never lowers an alert's severity,** so turning off a higher level while a lower one stays on sends nothing.

## Not Working?

1. **The log says `trigger sent`, but nothing appears in PagerDuty.** Check that the key belongs to an **Events API v2** integration on the service that you are watching. PagerDuty accepts events sent to a deleted key without saying so.
2. **`no routingKey set; PagerDuty is not started`.** Add the integration key in the plugin settings.
3. **`platform disabled; cached accessories kept`.** The configuration could not be used, and the lines before it say why. Your switches show No Response until you fix it.
4. **The delivery sensor is open.** Pages are not going out. The log says why.

The [full troubleshooting list](docs/README-DETAILED.md#troubleshooting) covers more, including EU accounts and key changes.

## Security

The integration key is stored in the Homebridge configuration file, like every Homebridge credential. Anyone who has it can page the people on call for that service, so treat it like a password. The plugin never writes it to the log. [SECURITY.md](SECURITY.md) has the detail.

## Requirements

- Homebridge 2.x
- Node.js 22.13 or later on 22, or Node.js 24 or 26
- A PagerDuty service with an Events API v2 integration
- A working internet connection

## More Info

- [Detailed documentation](docs/README-DETAILED.md)
- [Features](docs/FEATURES.md)
- [Signal store](docs/SIGNALS.md): how another plugin pages through this one
- [Signal store for coding agents](docs/SIGNALS-AGENT.md): point an agent at this to add signal support to a plugin
- [Events API reference](docs/EVENTS-API.md): what PagerDuty does with each event
- [Development](DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-pagerduty/issues)
- [Changelog](CHANGELOG.md)

## Trademarks

homebridge-pagerduty is an independent project. It is not affiliated with or endorsed by PagerDuty. PagerDuty is a trademark of PagerDuty, Inc.

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
