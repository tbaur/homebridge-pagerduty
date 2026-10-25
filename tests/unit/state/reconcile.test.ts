/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The reconciler decides every event the plugin sends. It is a pure function,
 * so its rules are pinned here as a table: desired against delivered, with
 * maintenance and rejections, and the one action (or none) each case yields.
 */

import type { DeliveredRecord, DesiredTarget, RejectedRecord } from '../../../src/state/model'
import { heldTarget } from '../../../src/state/model'
import { actionHash, reconcile, type HashContext, type ReconcileInput } from '../../../src/state/reconcile'
import type { Severity } from '../../../src/types'

const CONTEXT: HashContext = { routingKeyFingerprint: 'fp', region: 'us', pluginVersion: '1.0.0' }

function target(overrides: Partial<DesiredTarget> = {}): DesiredTarget {
  return {
    key: 'alert:leak',
    label: 'Leak',
    open: true,
    severity: 'critical',
    dedupKey: 'homebridge/leak',
    summary: 'Water detected',
    changedAt: 1_000,
    bypassMaintenance: false,
    held: false,
    details: { component: 'leak', group: 'homebridge-pagerduty', custom: { origin: 'switch' } },
    ...overrides,
  }
}

function delivered(severity: Severity = 'critical', dedupKey = 'homebridge/leak'): DeliveredRecord {
  return { dedupKey, severity, openedAt: 500 }
}

function run(input: {
  desired?: DesiredTarget[]
  delivered?: Record<string, DeliveredRecord>
  rejected?: Record<string, RejectedRecord>
  maintenanceOn?: boolean
}): ReturnType<typeof reconcile> {
  const full: ReconcileInput = {
    desired: new Map((input.desired ?? []).map((entry) => [entry.key, entry])),
    delivered: input.delivered ?? {},
    rejected: input.rejected ?? {},
    maintenanceOn: input.maintenanceOn ?? false,
    hashContext: CONTEXT,
  }
  return reconcile(full)
}

function summarize(plan: ReturnType<typeof reconcile>): string[] {
  return plan.sendable.map((action) => (action.kind === 'trigger'
    ? `trigger ${action.key} ${action.severity}`
    : `resolve ${action.key} ${action.dedupKey}`))
}

describe('reconcile', () => {
  it.each<[string, Parameters<typeof run>[0], string[]]>([
    ['open and never delivered: trigger', { desired: [target()] }, ['trigger alert:leak critical']],
    ['open and delivered at the same severity, with no recorded summary: nothing', {
      desired: [target()], delivered: { 'alert:leak': delivered() },
    }, []],
    ['open at the same severity with a new summary: trigger', {
      desired: [target({ summary: 'Still wet' })],
      delivered: { 'alert:leak': { ...delivered(), summary: 'Water detected' } },
    }, ['trigger alert:leak critical']],
    ['open at a lower severity with a new summary: nothing', {
      desired: [target({ severity: 'warning', summary: 'Still wet' })],
      delivered: { 'alert:leak': { ...delivered(), summary: 'Water detected' } },
    }, []],
    ['open at a higher severity than delivered: trigger again', {
      desired: [target({ severity: 'critical' })], delivered: { 'alert:leak': delivered('warning') },
    }, ['trigger alert:leak critical']],
    ['open at a lower severity than delivered: nothing, PagerDuty never lowers', {
      desired: [target({ severity: 'warning' })], delivered: { 'alert:leak': delivered('critical') },
    }, []],
    ['closed and delivered: resolve', {
      desired: [target({ open: false })], delivered: { 'alert:leak': delivered() },
    }, ['resolve alert:leak homebridge/leak']],
    ['closed and not delivered: nothing', { desired: [target({ open: false })] }, []],
    ['delivered with no desired target (alert removed): resolve', {
      delivered: { 'alert:gone': delivered('error', 'homebridge/gone') },
    }, ['resolve alert:gone homebridge/gone']],
    ['delivered under another dedup key (source changed): resolve the old key first', {
      desired: [target({ dedupKey: 'renamed/leak' })], delivered: { 'alert:leak': delivered('critical', 'homebridge/leak') },
    }, ['resolve alert:leak homebridge/leak']],
  ])('%s', (_name, input, expected) => {
    expect(summarize(run(input))).toEqual(expected)
  })

  it('sends resolves before triggers, so a full queue never delays an all-clear', () => {
    const plan = run({
      desired: [target({ key: 'alert:a', dedupKey: 'homebridge/a' }), target({ key: 'alert:b', dedupKey: 'homebridge/b', open: false })],
      delivered: { 'alert:b': delivered('critical', 'homebridge/b') },
    })

    expect(summarize(plan)).toEqual(['resolve alert:b homebridge/b', 'trigger alert:a critical'])
  })

  it('holds a trigger during maintenance and says so', () => {
    const plan = run({ desired: [target()], maintenanceOn: true })

    expect(plan.sendable).toEqual([])
    expect(plan.heldByMaintenance).toEqual(['alert:leak'])
  })

  it('holds a severity raise during maintenance too', () => {
    const plan = run({ desired: [target()], delivered: { 'alert:leak': delivered('warning') }, maintenanceOn: true })

    expect(plan.heldByMaintenance).toEqual(['alert:leak'])
  })

  it('never holds a resolve during maintenance', () => {
    const plan = run({ desired: [target({ open: false })], delivered: { 'alert:leak': delivered() }, maintenanceOn: true })

    expect(summarize(plan)).toEqual(['resolve alert:leak homebridge/leak'])
  })

  it('lets an alert that bypasses maintenance through', () => {
    const plan = run({ desired: [target({ bypassMaintenance: true })], maintenanceOn: true })

    expect(summarize(plan)).toEqual(['trigger alert:leak critical'])
  })

  it('does nothing for a held config entry, open or closed', () => {
    const plan = run({ desired: [heldTarget('alert:leak', 'leak')], delivered: { 'alert:leak': delivered() } })

    expect(plan).toEqual({ sendable: [], heldByMaintenance: [], rejected: [] })
  })

  it('does not resend an action whose hash matches an outstanding rejection', () => {
    const first = run({ desired: [target()] })
    const action = first.sendable[0]!
    const plan = run({
      desired: [target()],
      rejected: { 'alert:leak': { desiredHash: action.hash, at: 1, reason: 'HTTP 400' } },
    })

    expect(plan.sendable).toEqual([])
    expect(plan.rejected).toEqual(['alert:leak'])
  })

  it('sends again once the desired state differs from what was rejected', () => {
    const first = run({ desired: [target()] })
    const plan = run({
      desired: [target({ summary: 'Fixed summary' })],
      rejected: { 'alert:leak': { desiredHash: first.sendable[0]!.hash, at: 1, reason: 'HTTP 400' } },
    })

    expect(summarize(plan)).toEqual(['trigger alert:leak critical'])
  })

  it('labels a resolve for a removed target from its key', () => {
    const plan = run({ delivered: { 'signal:homebridge-example/sump': delivered('error', 'x') } })

    expect(plan.sendable[0]!.label).toBe('homebridge-example/sump')
  })

  it('carries what the event body needs on a trigger', () => {
    const plan = run({ desired: [target({ changedAt: 42 })] })

    expect(plan.sendable[0]).toEqual(expect.objectContaining({
      kind: 'trigger', dedupKey: 'homebridge/leak', summary: 'Water detected', timestamp: 42,
    }))
  })
})

describe('actionHash', () => {
  const action = { open: true, severity: 'critical' as const, dedupKey: 'k', summary: 's' }

  it('is stable for the same inputs', () => {
    expect(actionHash(action, CONTEXT)).toBe(actionHash({ ...action }, { ...CONTEXT }))
  })

  it.each<[string, HashContext]>([
    ['a new routing key', { ...CONTEXT, routingKeyFingerprint: 'other' }],
    ['a new region', { ...CONTEXT, region: 'eu' }],
    ['an upgrade', { ...CONTEXT, pluginVersion: '1.0.1' }],
  ])('changes with %s, so a refused event is retried', (_name, context) => {
    expect(actionHash(action, context)).not.toBe(actionHash(action, CONTEXT))
  })
})
