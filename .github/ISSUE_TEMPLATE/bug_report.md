---
name: Bug Report
about: Report a bug to help us improve
title: '[Bug] '
labels: bug
assignees: ''
---

> **Never paste your PagerDuty integration key (routing key).** Anyone holding it can open incidents on your service. The plugin never logs it; please keep it out of anything you paste here, including `config.json` excerpts.

## Description
A clear description of what the bug is.

## Environment

- **Plugin version**:
- **Homebridge version**:
- **Node.js version**:
- **Operating system**:
- **Region**: `us` or `eu`
- **Which part**: alert switch / severity levels / resolve timer / maintenance switch / delivery sensor / signal store

## Steps to Reproduce

1.
2.
3.

## Expected Behavior
What you expected to happen, in HomeKit and in PagerDuty.

## Actual Behavior
What actually happened. If PagerDuty shows something different from the log, say what the incident timeline shows.

## Logs

Run Homebridge with debug logging (`homebridge -D`) and include the startup lines plus anything around the failure. Alert names and summaries appear in the log; replace any you would rather not publish.

<details>
<summary>Click to expand logs</summary>

```
Paste relevant logs here
```

</details>

## Additional Context
Any other context about the problem.
