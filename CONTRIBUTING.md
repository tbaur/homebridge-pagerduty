# Contributing to homebridge-pagerduty

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

You need **Node.js 22.13 or later, 24 or 26** (the range the plugin declares in `engines`). CI runs the test suite on 22.13.0, 22, 24 and 26.

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/homebridge-pagerduty.git
   cd homebridge-pagerduty
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Development Workflow

### Running Tests

```bash
npm test              # Build, then Jest with coverage (NODE_ENV=test)
npm run lint          # Warnings are failures
npm run lint:fix      # Auto-fix style issues
npx tsc --noEmit -p tsconfig.test.json  # src + tests
```

The suite never sends an event. It also refuses to run if `PAGERDUTY_ROUTING_KEY` is set in your environment, which stops a half-finished test from paging a real person.

### Code Style

- Use `const`/`let`, never `var`
- Use async/await over raw Promises
- Add JSDoc comments for public functions
- Comments explain *why*, not *what*
- Follow existing code patterns

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Add/update tests
4. Ensure all tests pass: `npm test` (coverage must stay at or above 90%)
5. Ensure linting passes: `npm run lint`
6. Rebuild and commit the compiled output: `npm run build`, then commit any changes under `dist/`. `dist/` is tracked in git so installing from a git URL works, and CI fails if it drifts from `src/`.
7. Commit with a descriptive message

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org). PR titles drive automated releases via release-please, so use prefixes like:

- `feat:` - New feature (minor bump)
- `fix:` - Bug fix (patch bump)
- `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer - major bump
- `docs:` / `test:` / `refactor:` / `chore:` / `ci:` - no release

Example: `feat: add a routing key per alert`

See [RELEASING.md](RELEASING.md#version-bumps) for the full table.

## Pull Request Process

1. Update documentation if needed
2. Ensure CI passes (build, lint, typecheck, tests, `dist/` in sync)
3. Request review from maintainers

> `CHANGELOG.md` is generated automatically by release-please from your Conventional Commit and PR titles. Do not edit it by hand. See [RELEASING.md](RELEASING.md).

### PR Checklist

- [ ] Tests added/updated
- [ ] Linting passes
- [ ] `dist/` rebuilt and committed (`npm run build`)
- [ ] Documentation updated
- [ ] No integration key, address or real name in any committed file
- [ ] Descriptive PR title (Conventional Commits)

## Changing Behavior

Read the invariants in [DEVELOPMENT.md](DEVELOPMENT.md#invariants) first. Three things are worth knowing before you start:

- **This pages people.** A bug here either wakes someone for nothing or fails to wake them when it matters. Changes to what is sent belong in `src/state/desired.ts` or `src/state/reconcile.ts`, which are pure and tested table-driven.
- **The signal schema is a published interface.** Other plugins run that exact text, copied from `docs/SIGNALS.md`, `docs/SIGNALS-AGENT.md` or `scripts/reference-writer.js`. Changing it in a way that breaks a writer means a new interface identifier, and a PR that does so needs to say why. See [Signal store interface](DEVELOPMENT.md#signal-store-interface).
- **Do not break someone's tiles.** Accessory identity is alert id plus severity. A change that alters the identity of an existing accessory removes it, with its room and automations. If it must, say so explicitly in the PR so it is handled as a migration.

## Reporting Bugs

Use the GitHub issue template. Include:
- Homebridge version
- Plugin version
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs. With `options.diagnosticsInterval` set, the `Diagnostics start` line is a useful summary of your setup

**Never paste your integration key.** The plugin never logs it, so a log is safe to share as far as the key goes. Your alert names and summaries are in the log, so read it before you paste it.

## Feature Requests

Open an issue with:
- Clear description of the feature
- Use case / why it is needed
- Any implementation ideas

## Questions?

Check [existing issues](https://github.com/tbaur/homebridge-pagerduty/issues) first, and open a new one if your question is not already covered.

---

Thank you for contributing! 🎉
