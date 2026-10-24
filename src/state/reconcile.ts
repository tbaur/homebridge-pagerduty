/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The reconciler: desired against delivered, as a pure function.
 *
 * No timers, no I/O and no clock. Given the same inputs it returns the same
 * plan, which is why most of the test suite drives this directly and why a
 * restart resumes exactly where it stopped.
 *
 * Rules, per target:
 * - Delivered but no longer desired open, or delivered under a different
 *   `dedup_key`: **resolve** on the recorded key. Never held.
 * - Desired open and either not delivered, or desired severity higher than
 *   delivered: **trigger**. Held by maintenance unless the alert bypasses it.
 * - Desired severity lower than delivered: nothing. PagerDuty never lowers an
 *   alert, and the plugin does not pretend it can.
 * - A held (invalid) config entry: nothing, in either direction.
 * - An action whose hash matches an outstanding rejection: not resent.
 */

import { createHash } from 'node:crypto'

import type { Region, Severity } from '../types'
import { severityRank } from '../types'
import type { DeliveredRecord, DesiredTarget, EventDetails, RejectedRecord } from './model'

/** Everything a rejection hash depends on besides the action itself. */
export interface HashContext {
  routingKeyFingerprint: string
  region: Region
  pluginVersion: string
}

/** A trigger the sender may send. */
export interface TriggerAction {
  kind: 'trigger'
  key: string
  label: string
  dedupKey: string
  severity: Severity
  summary: string
  timestamp: number
  details: EventDetails
  hash: string
}

/** A resolve the sender may send. */
export interface ResolveAction {
  kind: 'resolve'
  key: string
  label: string
  dedupKey: string
  hash: string
}

export type Action = TriggerAction | ResolveAction

/** Every gap, sorted by what may happen to it. */
export interface Plan {
  /** In send order: resolves first, then triggers, each by key. */
  sendable: Action[]
  /** Target keys with a trigger held by maintenance. */
  heldByMaintenance: string[]
  /** Target keys whose gap matches an outstanding rejection. */
  rejected: string[]
}

/** Inputs to {@link reconcile}. */
export interface ReconcileInput {
  desired: ReadonlyMap<string, DesiredTarget>
  delivered: Readonly<Record<string, DeliveredRecord>>
  rejected: Readonly<Record<string, RejectedRecord>>
  maintenanceOn: boolean
  hashContext: HashContext
}

/**
 * The hash a rejection is recorded under.
 *
 * Covers what was (or would be) sent plus the key fingerprint, the region and
 * the plugin version. A new key, a new region or an upgrade therefore retries
 * an event PagerDuty refused, and nothing else does.
 */
export function actionHash(
  action: { open: boolean; severity: Severity | null; dedupKey: string; summary: string | null },
  context: HashContext,
): string {
  return createHash('sha256').update(JSON.stringify([
    action.open,
    action.severity,
    action.dedupKey,
    action.summary,
    context.routingKeyFingerprint,
    context.region,
    context.pluginVersion,
  ])).digest('hex')
}

/** Compare desired against delivered and say what may be sent next. */
export function reconcile(input: ReconcileInput): Plan {
  const keys = [...new Set([...input.desired.keys(), ...Object.keys(input.delivered)])].sort()
  const resolves: Action[] = []
  const triggers: Action[] = []
  const plan: Plan = { sendable: [], heldByMaintenance: [], rejected: [] }
  for (const key of keys) {
    const target = input.desired.get(key)
    const action = gapFor(key, target, input)
    if (action === undefined) {
      continue
    }
    if (input.rejected[key]?.desiredHash === action.hash) {
      plan.rejected.push(key)
    } else if (action.kind === 'trigger' && input.maintenanceOn && target?.bypassMaintenance !== true) {
      plan.heldByMaintenance.push(key)
    } else {
      (action.kind === 'resolve' ? resolves : triggers).push(action)
    }
  }
  plan.sendable = [...resolves, ...triggers]
  return plan
}

function gapFor(key: string, target: DesiredTarget | undefined, input: ReconcileInput): Action | undefined {
  if (target?.held === true) {
    return undefined
  }
  const delivered = input.delivered[key]
  if (delivered !== undefined && (target === undefined || !target.open || target.dedupKey !== delivered.dedupKey)) {
    return {
      kind: 'resolve',
      key,
      label: target?.label ?? labelFromKey(key),
      dedupKey: delivered.dedupKey,
      hash: actionHash({ open: false, severity: null, dedupKey: delivered.dedupKey, summary: null }, input.hashContext),
    }
  }
  if (target === undefined || !target.open) {
    return undefined
  }
  if (delivered !== undefined && severityRank(target.severity) <= severityRank(delivered.severity)) {
    return undefined
  }
  return {
    kind: 'trigger',
    key,
    label: target.label,
    dedupKey: target.dedupKey,
    severity: target.severity,
    summary: target.summary,
    timestamp: target.changedAt,
    details: target.details,
    hash: actionHash({ open: true, severity: target.severity, dedupKey: target.dedupKey, summary: target.summary }, input.hashContext),
  }
}

/** `alert:leak` reads as `leak`, `signal:pkg/sig` as `pkg/sig`. */
function labelFromKey(key: string): string {
  const colon = key.indexOf(':')
  return colon >= 0 ? key.slice(colon + 1) : key
}
