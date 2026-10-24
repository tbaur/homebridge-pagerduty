#!/usr/bin/env node
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * End-to-end check against a real PagerDuty service: send one trigger, wait,
 * send the matching resolve.
 *
 * With `--raise LEVEL`, a second trigger on the same key raises the open
 * alert's severity before the resolve, the way a second alert level does.
 *
 * PagerDuty answers `202` even for a deleted integration key, so a clean run
 * here only proves the request was accepted. Watch the service in PagerDuty
 * to see the alert open and close.
 *
 * This pages whoever is on call for that service. Point it at a test service.
 *
 * Usage: node scripts/smoke.js [--region us|eu] [--source NAME] [--severity LEVEL] [--raise LEVEL] [--wait SECONDS] [--yes]
 */
const { ask, fail, parseFlags, requireBuild, resolveRoutingKey, run } = require('./lib/common')

const FLAGS = { region: 'string', source: 'string', severity: 'string', raise: 'string', wait: 'string', yes: 'boolean' }
const SEVERITIES = ['info', 'warning', 'error', 'critical']
const DEFAULT_WAIT_SECONDS = 30
const MAX_WAIT_SECONDS = 600

function options(flags) {
  const region = flags.region ?? 'us'
  const source = flags.source ?? 'homebridge-smoke'
  const severity = flags.severity ?? 'info'
  const raise = flags.raise
  const wait = Number(flags.wait ?? DEFAULT_WAIT_SECONDS)
  if (region !== 'us' && region !== 'eu') {
    fail('--region must be us or eu')
  }
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(source)) {
    fail('--source must be 1-32 letters, digits, dot, underscore or hyphen')
  }
  if (!SEVERITIES.includes(severity)) {
    fail(`--severity must be one of ${SEVERITIES.join(', ')}`)
  }
  if (raise !== undefined && SEVERITIES.indexOf(raise) <= SEVERITIES.indexOf(severity)) {
    fail(`--raise must be a severity above ${severity}: ${SEVERITIES.slice(SEVERITIES.indexOf(severity) + 1).join(', ') || 'none'}`)
  }
  if (!Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT_SECONDS) {
    fail(`--wait must be a whole number of seconds from 0 to ${MAX_WAIT_SECONDS}`)
  }
  return { region, source, severity, raise, wait }
}

function describePlan({ region, severity, raise, wait }, dedupKey) {
  const steps = raise === undefined
    ? `then resolves it after ${wait}s`
    : `raises it to ${raise} after ${wait}s, then resolves it after another ${wait}s`
  return `\nThis sends a trigger (severity ${severity}) to the ${region.toUpperCase()} Events API as ${dedupKey}, ${steps}.`
}

function trigger(dedupKey, severity, group) {
  return {
    kind: 'trigger',
    key: 'smoke',
    label: 'smoke',
    dedupKey,
    severity,
    summary: 'homebridge-pagerduty smoke test',
    timestamp: Date.now(),
    details: { component: 'smoke', group, custom: { origin: 'smoke' } },
    hash: '',
  }
}

async function send(action, context) {
  const { buildEvent, postJson, classifyStatus, rejectionReason, settings } = context
  const body = buildEvent(action, { routingKey: context.routingKey, source: context.source })
  const started = Date.now()
  const response = await postJson(settings.EVENTS_URLS[context.region], body, {
    connectTimeoutMs: settings.CONNECT_TIMEOUT_MS,
    totalTimeoutMs: settings.REQUEST_TIMEOUT_MS,
    maxBytes: settings.MAX_RESPONSE_BYTES,
  })
  const outcome = classifyStatus(response.status)
  const detail = outcome === 'delivered' ? '' : ` (${rejectionReason(response.status, response.body)})`
  const what = action.kind === 'trigger' ? `trigger (${action.severity})` : 'resolve'
  console.log(`  ${what}: HTTP ${response.status}, ${outcome}, ${Date.now() - started} ms${detail}`)
  if (outcome !== 'delivered') {
    throw new Error(`${action.kind} was not accepted`)
  }
}

async function pause(seconds, note) {
  if (seconds > 0) {
    console.log(`  waiting ${seconds}s; ${note}`)
    await new Promise((resolve) => setTimeout(resolve, seconds * 1_000))
  }
}

async function confirm(flags) {
  if (flags.yes === true) {
    return true
  }
  return (await ask('Send? [y/N] ')).toLowerCase() === 'y'
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), FLAGS)
  const plan = options(flags)
  const { buildEvent, classifyStatus, rejectionReason } = requireBuild('delivery/events')
  const { postJson } = requireBuild('delivery/http')
  const settings = requireBuild('settings')
  const routingKey = await resolveRoutingKey()

  const dedupKey = `${plan.source}/smoke-${Date.now()}`
  console.log(describePlan(plan, dedupKey))
  console.log('It pages whoever is on call for that service.')
  if (!await confirm(flags)) {
    console.log('Nothing sent.')
    return
  }

  const context = { buildEvent, postJson, classifyStatus, rejectionReason, settings, routingKey, source: plan.source, region: plan.region }
  await send(trigger(dedupKey, plan.severity, settings.EVENT_GROUP), context)
  await pause(plan.wait, 'the alert should be open in PagerDuty now')
  if (plan.raise !== undefined) {
    await send(trigger(dedupKey, plan.raise, settings.EVENT_GROUP), context)
    await pause(plan.wait, `the same alert should now show ${plan.raise}`)
  }
  await send({ kind: 'resolve', key: 'smoke', label: 'smoke', dedupKey, hash: '' }, context)
  console.log('\nAccepted. Check the service in PagerDuty: the alert should be resolved.')
}

run(main)
