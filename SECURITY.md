# Security Policy

## Supported Versions

| Version | Supported              |
| ------- | ---------------------- |
| 2.x.x   | ✅ Supported           |
| < 2.0   | ❌ Not supported       |

## Reporting a Vulnerability

Do not open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/tbaur/homebridge-pagerduty/security/advisories/new), and include a description, how to reproduce it, and the impact.

## Summary

**This plugin needs a PagerDuty integration key and stores it in plain text in the Homebridge configuration file.** Every Homebridge plugin stores its credentials that way, because Homebridge offers no secret store.

What follows from that:

- Anyone who can read your Homebridge config can page the people on call for that service, with any message they like.
- The key can only send events to one service. It cannot read incidents, change schedules or reach the rest of your PagerDuty account.
- PagerDuty accepts events for a deleted or disabled key without saying so. The plugin cannot tell you that a key has been revoked.

If a key leaks, delete the integration in PagerDuty, create a new one, and put the new key in the plugin settings. The plugin warns about any alerts that were open on the old key.

## Security Measures

- **The key in one place.** The integration key is read from configuration, held in memory and sent only to the PagerDuty Events host for the configured region, over HTTPS. It is never written to a log, not even its length or a prefix. It is never placed in an accessory's cache, and never accepted by a script as a command-line argument.
- **Only a fingerprint at rest.** The state file stores a SHA-256 fingerprint of the key, used only to notice that the key changed.
- **Redaction by shape, not by name.** `src/utils/redact.ts` matches key-shaped strings by their form, so a PagerDuty error that echoes the key is redacted before it is logged. Errors never include a URL or a request body.
- **Escaped log values.** Alert names, summaries and anything written by another plugin pass through `forLog`, which escapes control characters and caps length. A value cannot inject a fake log line or terminal escape codes.
- **Input validation.** Config is checked at startup. A missing key starts nothing. An unusable config disables the platform without unregistering accessories. A bad alert entry is held until it is fixed.
- **Bounded I/O.** Separate connect and total timeouts on every request, a 64 KiB response cap, and no redirects followed.
- **Owner-only files.** The plugin writes to one `homebridge-pagerduty` directory inside the Homebridge storage directory, created with mode `0700`, plus the settings screen file `.homebridge-pagerduty-v1.schema.json` next to it, where the Homebridge UI looks for it. The state file, the settings screen file and the signal store, including its `-wal` and `-shm` files, are created with mode `0600`. Store files found with a looser mode are tightened, and the plugin logs that.
- **No runtime dependencies.** HTTPS and SQLite come from Node.
- **Dependencies audited.** CI runs `npm audit` on the runtime tree and OSV-Scanner on the full tree.
- **A CI step rejects key-shaped strings** in the docs, source, tests, scripts, schema and workflows, so a key cannot be committed by accident. Tests build their fake keys at runtime, and the suite refuses to run if `PAGERDUTY_ROUTING_KEY` is set.
- **Opt-in diagnostics are logs only.** `options.diagnosticsInterval` writes a periodic health line from in-memory counters. It makes no network call, and its config summary shows the key only as present or absent.

## The signal store

Other plugins can raise alerts by writing rows to `homebridge-pagerduty/signals.sqlite` in the Homebridge storage directory. [docs/SIGNALS.md](docs/SIGNALS.md) is the interface, and [docs/SIGNALS-AGENT.md](docs/SIGNALS-AGENT.md) is the same interface written for coding agents.

**Allowing a plugin is not authentication.** The **Allow this plugin to page** setting stops a well-behaved plugin from paging someone who never asked it to. It does not stop hostile code: any process that runs as the Homebridge user can write a row under any package name. Such a process can also read `config.json`, and the key in it, so the store adds no new exposure.

What the plugin does to keep the store safe to read:

- The list of allowed plugins is part of the SQL query, so rows from other plugins cannot push allowed rows out of the read.
- Names and text that other plugins write are validated and length-capped. On the settings screen, that text is only ever a field's starting value, never a title or description, which the Homebridge UI renders as markup.
- The schema's `CHECK` constraints limit `plugin` to package-name characters and cap every text column. Rows are validated again when read, in case another plugin created the table differently.
- A read error never clears an alert, so a damaged or locked store cannot silently resolve a page.

## Best Practices for Users

1. Keep Homebridge and this plugin updated.
2. Run Homebridge with minimal privileges, and do not expose it to the internet.
3. Protect the Homebridge configuration file and any backup of it as you would a password file, because it contains a key that can page people.
4. Use a dedicated PagerDuty service, or at least a dedicated integration, for this plugin, so you can revoke its key without affecting anything else.
5. Allow only plugins you trust under Plugin Signals.
6. Test once after setup and after any key change, because PagerDuty accepts events for a revoked key.

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release
