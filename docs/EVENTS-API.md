# PagerDuty Events API v2: what the plugin relies on

This plugin uses one PagerDuty interface: `POST /v2/enqueue` on the Events API v2. It sends `trigger` and `resolve`. It never calls the REST API and never reads PagerDuty state.

The table lists each PagerDuty behavior that the plugin depends on, and what the plugin does because of it.

## Facts and their consequences

| Fact | What the plugin does about it |
|---|---|
| The endpoint is `https://events.pagerduty.com/v2/enqueue`. EU accounts use `https://events.eu.pagerduty.com/v2/enqueue`. PagerDuty forwards EU keys sent to the US host, but recommends the EU host. | A `region` setting, `us` or `eu`. Each host is a constant, never a free-text URL. |
| `routing_key` is the 32-character integration key from a service integration or an event ruleset. | Validated as `^[A-Za-z0-9]{32}$`. Never logged, not even its length or a prefix. |
| `payload.summary` (at most 1024 characters), `payload.source` and `payload.severity` are required on a `trigger`. | `summary` is required on every alert and capped at 1024. `source` is a setting. |
| Severity is exactly `critical`, `error`, `warning` or `info`, case-sensitive. | Validated in config, in the schema and in the signal store's `CHECK` constraint. |
| `dedup_key` is at most 255 characters. | The longest key the plugin can build is 226 characters. |
| A `trigger` with the key of an open alert adds an entry to that alert's log. It does not open a second alert. | A repeat trigger is safe, so a restart or a retry cannot create duplicates. |
| An alert takes the highest severity it has received. Incident urgency is raised to match and never lowered. | A severity raise is sent as another `trigger`. The plugin never sends a lower severity for an open alert. |
| After an alert is resolved, a `trigger` with the same key opens a new alert. A `resolve` with no open alert is dropped. | Resolving a closed alert is harmless, which makes the resolve sweep after a lost state file safe. |
| A `resolve` only applies if it arrives on the same `routing_key` as the trigger. Otherwise it is dropped. | Changing the integration key would orphan open alerts. The plugin detects the change, names the open alerts in a `warn`, and tells the user to resolve them in PagerDuty. |
| While an incident is acknowledged, PagerDuty sends no notifications, even for new triggers. | The [detailed documentation](README-DETAILED.md#what-the-plugin-does-not-track) says that a severity raise on an acknowledged incident pages no one. |
| `202` means accepted and queued, not "incident created". `400` means invalid: do not retry. `429`, `5xx` and network errors should be retried, with a backoff of minutes for `429`. Rate limits are dynamic and per service. | See [Status handling](#status-handling). |
| If the service uses alert severity to set urgency, `critical` and `error` are high urgency, and `warning` and `info` are low. | A change between two severities with the same urgency does not change who is notified. The [complete example](README-DETAILED.md#a-complete-example) pairs `warning` with `critical` for that reason. |
| A PagerDuty maintenance window drops triggers on the service. It also drops resolves, so the incident stays open and keeps notifying. | This plugin's maintenance switch holds triggers and always sends resolves. The README tells users not to use PagerDuty maintenance windows on this service. |
| Events sent to a deleted integration key, a disabled service or a service in maintenance still get a `2xx`. | The plugin cannot detect a revoked or deleted key. The README asks users to test once after setup, and `scripts/smoke.js` does the same from a terminal. |
| Whether `429` carries `Retry-After` is not documented. | Honored when present, up to 15 minutes. Never depended on. |
| The payload limit is 512 KB. | Not a practical limit: a trigger body is a few kilobytes at most. |

## Status handling

One request is in flight at a time, because there is one endpoint and one sender.

| Status | What happens |
|---|---|
| `202`, or any other `2xx` | Accepted. The plugin records the `dedup_key` and severity of the request it sent, never the state at the moment the response arrives. A `2xx` other than `202` also logs a `warn`, because PagerDuty does not document one. |
| `408`, `429` | Retried with equal jitter: wait at least half the base, plus a random amount up to the other half. The base starts at 60 seconds and doubles to 5 minutes. A `Retry-After` header wins when it asks for longer, up to 15 minutes. |
| Any other `4xx` | Rejected. Not retried. The reason from PagerDuty's `errors` array is logged, redacted and length-capped. The rejected state is remembered so it is not resent, and the delivery sensor opens. The alert is tried again as soon as it changes, or after the plugin is upgraded or the key, region or source changes. |
| `3xx`, `5xx`, timeout, network error | Retried with full jitter: a random wait up to the base, which starts at 5 seconds and doubles to 5 minutes. Redirects are never followed. |

An outage logs one `warn` when it starts, repeats it at most hourly, and logs one `info` when PagerDuty answers again.

The connection deadline is 5 seconds and the whole request must finish in 30. A response larger than 64 KiB is refused.

## Event bodies

Trigger:

```json
{
  "routing_key": "<routing key>",
  "event_action": "trigger",
  "dedup_key": "homebridge/freezer",
  "client": "Homebridge",
  "payload": {
    "summary": "Freezer temperature is high",
    "source": "homebridge",
    "severity": "critical",
    "timestamp": "2026-10-23T21:14:05.000Z",
    "component": "freezer",
    "group": "homebridge-pagerduty",
    "custom_details": { "origin": "switch", "level": "Freezer Hot" }
  }
}
```

Resolve:

```json
{ "routing_key": "<routing key>", "event_action": "resolve", "dedup_key": "homebridge/freezer" }
```

- `dedup_key` is `<source>/<alert id>` for an alert and `<source>/<plugin>/<signal>` for a signal row that is not tied to an alert. An alert id cannot contain `/`, so the two forms cannot collide.
- `timestamp` is when the condition changed, not when the request was sent. A trigger delivered after an outage still shows the real start time.
- A resolve always uses the `dedup_key` recorded when the alert was opened. Changing `source` while an alert is open therefore resolves the old key and triggers the new one.
