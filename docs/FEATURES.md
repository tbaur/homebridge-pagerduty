# Features

What the plugin does, and what it does not do.

## Per alert

- ✅ One HomeKit switch per severity level, up to four levels per alert, all feeding one PagerDuty alert
- ✅ Severity raised as more levels turn on, never lowered
- ✅ Resolve timer, saved across restarts
- ✅ `bypassMaintenance` for alerts that must always page

## Per install

- ✅ Maintenance switch that holds triggers, always sends resolves, and turns itself off
- ✅ Delivery sensor that opens when pages are not going out
- ✅ Signal store that other plugins write to. Each plugin appears in the settings by itself, and pages only once the user allows it
- ✅ For each signal from another plugin: an editable PagerDuty message, a severity override, paging during maintenance, mute, and an optional HomeKit switch
- ✅ A tested module and instructions that a plugin author or coding agent can use to add signal support
- ✅ Dry-run mode that logs what would be sent
- ✅ US and EU PagerDuty regions

## Reliability

- ✅ Desired and accepted state both saved, so a restart resumes where it stopped
- ✅ Current state sent after an outage, never a backlog
- ✅ Rejected events not resent in a loop
- ✅ Backoff of minutes on rate limits, with `Retry-After` honored
- ✅ Invalid alert entries held, not removed
- ✅ Integration key changes detected, with the orphaned alerts named
- ✅ A resolve for every alert that might be open after the state file is lost
- ✅ Signal store read errors never treated as a clear

## Quality

- ✅ Strict TypeScript with `noUncheckedIndexedAccess`
- ✅ 90% coverage gate
- ✅ No runtime dependencies
- ✅ Opt-in diagnostics heartbeat with optional JSON lines
- ✅ Homebridge v2.0+ support
- ✅ Node.js 22.13+, 24 and 26 support

## Out of scope

- ❌ **Acknowledging incidents**
- ❌ **Reading PagerDuty.** No REST API, no webhooks, and no switch that moves when an incident changes in PagerDuty
- ❌ **Change events, images and links in events**
- ❌ **Changing PagerDuty service settings** such as auto-resolve or dynamic notifications
- ❌ **A delay before resolve on a brief recovery.** Use a Home automation with a condition, or a resolve timer
- ❌ **Detecting that Homebridge is down.** That needs a monitor outside the install
- ❌ **Detecting a revoked or deleted integration key.** PagerDuty accepts events for one
- ❌ **Working with PagerDuty maintenance windows.** PagerDuty drops resolves during one

## Accessories

| Accessory | HomeKit service | Count |
| --- | --- | --- |
| Alert level | Switch | One per level of each alert |
| Maintenance | Switch | One, when `maintenance.switch` is true |
| Delivery | ContactSensor, open means pages are not going out | One, unless `options.deliveryFaultSensor` is false |

## PagerDuty surface

What the plugin sends and what PagerDuty does with it: [EVENTS-API.md](EVENTS-API.md).

## Architecture

See [DEVELOPMENT.md](../DEVELOPMENT.md) for how to build, test and add a setting.
