# Maintenance scripts

Tools for the things CI cannot do: send a real event to a real PagerDuty service, and write a real signal row. They are not part of the published package (`files` in `package.json` excludes this directory) and they are not part of the test suite.

| Script | Sends to PagerDuty? | What it is for |
| --- | --- | --- |
| `smoke.js` | Yes, after asking | End-to-end check before a release: one trigger, a wait, then the matching resolve |
| `reference-writer.js` | No | The signal store writer from [docs/SIGNALS.md](../docs/SIGNALS.md), runnable. Writes one row |

## smoke.js

```bash
npm run build
node scripts/smoke.js
node scripts/smoke.js --region eu --severity warning --wait 60
```

It loads the compiled plugin from `dist/`, so the result says something about the code that actually ships. Run `npm run build` first.

The integration key comes from `PAGERDUTY_ROUTING_KEY`, or from a prompt that does not echo. **The script does not accept a key as a command-line argument,** because that puts it in your shell history and, on most systems, in the process list for every user on the machine. Anyone with the key can page whoever is on call.

**This pages whoever is on call for that service.** Point it at a test service. The script says what it will send and asks before sending; `--yes` skips the question.

| Option | Default | Meaning |
| --- | --- | --- |
| `--region` | `us` | `us` or `eu` |
| `--source` | `homebridge-smoke` | Event source and first part of the `dedup_key` |
| `--severity` | `info` | `info`, `warning`, `error` or `critical` |
| `--raise` | | After the wait, send a second trigger on the same key at this higher severity, then wait again before resolving. This is what a second alert level does |
| `--wait` | `30` | Seconds between the trigger and the resolve, 0–600 |
| `--yes` | | Do not ask before sending |

A clean run only proves PagerDuty accepted both events. PagerDuty also accepts events for a deleted key, so watch the service in PagerDuty: the alert should open, then resolve.

## reference-writer.js

```bash
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --severity warning --summary "Door open"
node scripts/reference-writer.js --storage /path/to/homebridge --plugin homebridge-example --signal door --clear
```

`--storage` is the Homebridge storage directory, the one that holds `config.json`. The plugin pages only if `homebridge-example` (or whatever `--plugin` you use) is in `signals.sources`.

The file has no dependencies and does not load `dist/`, because a writer must not depend on this package. That makes it the file a plugin author can copy. A test checks that its schema text matches the plugin's character for character, and that the plugin reads what it writes.

Needs Node 22.13 or later.
