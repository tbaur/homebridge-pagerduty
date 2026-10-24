# Security, Reliability, Maintainability and Serviceability Review

This document summarizes how the plugin handles security, reliability, maintainability and serviceability, and which practices support each. The plugin's only network interface is PagerDuty's Events API v2, which it writes to and never reads.

## Security

| Area | Status | Notes |
|------|--------|-------|
| **Credential handling** | ✅ | The integration key is read from config, held in memory and sent only to the PagerDuty Events host for the configured region. It is never logged, not even its length or a prefix, and never placed in an accessory's cache |
| **Key at rest** | ✅ | The state file stores a SHA-256 fingerprint of the key, used only to detect a key change |
| **Secret redaction** | ✅ | `redact.ts` redacts key-shaped strings by shape, not by field name, so a PagerDuty error that echoes the key is still covered. Errors never include a URL or a request body |
| **Log injection** | ✅ | Every value from config or from another plugin passes through `forLog`, which escapes control characters and caps length |
| **Signal store** | ✅ | In the plugin's owner-only directory (`0700`). Owner-only files (`0600`), tightened if found looser. The `signals.sources` list is applied inside the SQL query. Values are constrained by `CHECK` constraints and validated again on read |
| **HTTPS only** | ✅ | Two fixed hosts, no redirects followed, connect and total deadlines, response size capped at 64 KiB |
| **Scripts** | ✅ | The key comes from the environment or a prompt that does not echo. A key passed as a command-line argument is refused and not repeated |
| **Tests** | ✅ | Test keys are built at runtime, and the suite refuses to run with `PAGERDUTY_ROUTING_KEY` set. CI rejects credential-shaped strings in docs and source |
| **npm audit / CI** | ✅ | Runtime audit and OSV scan in CI |

**Residual risk:** Homebridge stores the integration key in plain text in `config.json`. Anyone who can read that file can page the people on call for the service. The signal store's `signals.sources` list is not authentication: any process running as the Homebridge user can write a row under any package name. That process could already read the key.

## Reliability

| Area | Status | Notes |
|------|--------|-------|
| **Reconciler** | ✅ | Desired state and accepted state are both saved. A pure function compares them and picks the next action, so restart, outage and maintenance need no special cases |
| **Delivery** | ✅ | One request at a time. Accepted state is recorded only after a `2xx`, and it records what was sent |
| **Retries** | ✅ | Full jitter from 5 seconds to 5 minutes for network and server errors. Equal jitter from 60 seconds to 5 minutes for `429` and `408`, with `Retry-After` honored up to 15 minutes |
| **Rejections** | ✅ | A `4xx` is not retried. It is remembered by a hash of the state, the key fingerprint, the region and the plugin version, so it is retried after a change or an upgrade, and never in a loop |
| **Outage logging** | ✅ | One `warn` at the start, repeated at most hourly, one `info` on recovery with a count of alerts that opened and closed meanwhile |
| **State file** | ✅ | Atomic replace with `fsync`, owner-only, writes serialized. A corrupt file is moved aside and followed by a resolve sweep. Any other read error disables the platform rather than starting empty |
| **Config errors** | ✅ | An invalid alert entry is held with its accessories and state. An unusable config disables the platform and keeps every cached accessory |
| **Signal store** | ✅ | A read error keeps the last rows. A replaced file is detected by inode and reopened. A busy store skips a poll after waiting at most 250 ms |
| **Maintenance** | ✅ | Holds triggers and raises, never resolves, and turns itself off after at most 7 days (default 4 hours) |
| **Timers** | ✅ | Resolve and maintenance deadlines are saved as absolute times and fire at startup if they passed while Homebridge was down |
| **Shutdown** | ✅ | Waits for a state write in progress. State is saved on every change, and the next start delivers anything left |

## Maintainability

| Area | Status | Notes |
|------|--------|-------|
| **TypeScript** | ✅ | Strict, with `noUncheckedIndexedAccess`. Tests compile under the same settings |
| **Lint** | ✅ | Type-aware ESLint, including no floating promises. Warnings fail the build |
| **Test coverage** | ✅ | 90% gate on statements, branches, functions and lines. The reconciler is tested table-driven, the reader against real SQLite including a child-process writer, and the HTTP client against a loopback server |
| **Code organization** | ✅ | `state/` (model, desired, reconcile, mutations, store), `delivery/`, `signals/`, `devices/`, `diagnostics/`, `utils/` |
| **Dependencies** | ✅ | None at runtime. HTTPS and SQLite come from Node |

## Serviceability

| Area | Status | Notes |
|------|--------|-------|
| **Logging** | ✅ | Every send, rejection, outage, maintenance change and config problem has one documented line. See [README-DETAILED.md](README-DETAILED.md#reading-the-log) |
| **Delivery sensor** | ✅ | A HomeKit contact sensor that opens when pages are not going out, so the failure reaches a person |
| **Config schema and validator** | ✅ | `config.schema.json` mirrors the validator's ranges, and a test compares each pair |
| **Diagnostics** | ✅ | Opt-in heartbeat: open, pending and held counts, store health, and API latency. `healthy` or `degraded` with reasons. Start and stop snapshots carry a redacted config echo. Optional JSON lines |
| **Dry run** | ✅ | Logs each event that would be sent, and sends nothing |
| **Smoke script** | ✅ | `scripts/smoke.js` sends one trigger and its resolve through the plugin's own compiled code |

## Scope

The plugin sends `trigger` and `resolve` to one PagerDuty service. It does not acknowledge, read PagerDuty, or detect a revoked key, because PagerDuty accepts events for one. [FEATURES.md](FEATURES.md#out-of-scope) lists what is out of scope.

## Quality gates

- **Tests:** Jest, run in CI on Node 22.13.0, 22, 24 and 26.
- **Coverage:** 90% gate across statements, branches, functions and lines.
- **Lint:** ESLint flat config, zero warnings.
- **Build:** CI fails if `dist/` does not match `src/`.
- **Audit:** `npm audit` for runtime dependencies and an OSV scan.
