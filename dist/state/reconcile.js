"use strict";
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
 * - Desired open and either not delivered, desired severity higher than
 *   delivered, or the same severity with a new summary: **trigger**. Held by
 *   maintenance unless the alert bypasses it. A delivered record with no
 *   summary (written before summaries were stored) is not a summary change.
 * - Desired severity lower than delivered: nothing, including a new summary.
 *   PagerDuty never lowers an alert, and the plugin does not pretend it can.
 * - A held (invalid) config entry: nothing, in either direction.
 * - An action whose hash matches an outstanding rejection: not resent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionHash = actionHash;
exports.reconcile = reconcile;
const node_crypto_1 = require("node:crypto");
const types_1 = require("../types");
/**
 * The hash a rejection is recorded under.
 *
 * Covers what was (or would be) sent plus the key fingerprint, the region and
 * the plugin version. A new key, a new region or an upgrade therefore retries
 * an event PagerDuty refused, and nothing else does.
 */
function actionHash(action, context) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([
        action.open,
        action.severity,
        action.dedupKey,
        action.summary,
        context.routingKeyFingerprint,
        context.region,
        context.pluginVersion,
    ])).digest('hex');
}
/** Compare desired against delivered and say what may be sent next. */
function reconcile(input) {
    const keys = [...new Set([...input.desired.keys(), ...Object.keys(input.delivered)])].sort();
    const resolves = [];
    const triggers = [];
    const plan = { sendable: [], heldByMaintenance: [], rejected: [] };
    for (const key of keys) {
        const target = input.desired.get(key);
        const action = gapFor(key, target, input);
        if (action === undefined) {
            continue;
        }
        if (input.rejected[key]?.desiredHash === action.hash) {
            plan.rejected.push(key);
        }
        else if (action.kind === 'trigger' && input.maintenanceOn && target?.bypassMaintenance !== true) {
            plan.heldByMaintenance.push(key);
        }
        else {
            (action.kind === 'resolve' ? resolves : triggers).push(action);
        }
    }
    plan.sendable = [...resolves, ...triggers];
    return plan;
}
function gapFor(key, target, input) {
    if (target?.held === true) {
        return undefined;
    }
    const delivered = input.delivered[key];
    if (delivered !== undefined && (target === undefined || !target.open || target.dedupKey !== delivered.dedupKey)) {
        return {
            kind: 'resolve',
            key,
            label: target?.label ?? labelFromKey(key),
            dedupKey: delivered.dedupKey,
            hash: actionHash({ open: false, severity: null, dedupKey: delivered.dedupKey, summary: null }, input.hashContext),
        };
    }
    if (target === undefined || !target.open) {
        return undefined;
    }
    if (delivered !== undefined && (0, types_1.severityRank)(target.severity) < (0, types_1.severityRank)(delivered.severity)) {
        return undefined;
    }
    if (delivered !== undefined
        && (0, types_1.severityRank)(target.severity) === (0, types_1.severityRank)(delivered.severity)
        && (delivered.summary === undefined || delivered.summary === target.summary)) {
        return undefined;
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
    };
}
/** `alert:leak` reads as `leak`, `signal:pkg/sig` as `pkg/sig`. */
function labelFromKey(key) {
    const colon = key.indexOf(':');
    return colon >= 0 ? key.slice(colon + 1) : key;
}
