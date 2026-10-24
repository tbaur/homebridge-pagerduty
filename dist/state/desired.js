"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Desired state, derived from configuration and persisted state.
 *
 * Pure. Every rule about alerts and levels lives here: an alert is open
 * while any level is on, its severity is the highest level
 * that is on, and a bound alert takes its severity from the last row seen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDesired = computeDesired;
const schema_1 = require("../signals/schema");
const settings_1 = require("../settings");
const model_1 = require("./model");
/** Every target that should exist, by target key. Absent means "should be closed". */
function computeDesired(config, state) {
    const desired = new Map();
    const bound = new Set();
    for (const alert of config.alerts) {
        desired.set((0, model_1.alertTargetKey)(alert.id), alertTarget(alert, config.source, state));
        if (alert.signal !== undefined) {
            bound.add((0, schema_1.signalRefKey)(alert.signal));
        }
    }
    for (const id of config.heldAlertIds) {
        desired.set((0, model_1.alertTargetKey)(id), (0, model_1.heldTarget)((0, model_1.alertTargetKey)(id), id));
    }
    for (const [refKey, row] of Object.entries(state.rowsSeen)) {
        const ref = parseRefKey(refKey);
        if (ref === undefined || bound.has(refKey) || !config.signalSources.includes(ref.plugin)) {
            continue;
        }
        const key = (0, model_1.signalTargetKey)(ref);
        desired.set(key, {
            key,
            label: refKey,
            open: row.active,
            severity: row.severity,
            dedupKey: (0, model_1.signalDedupKey)(config.source, ref),
            summary: row.summary,
            changedAt: row.changedAt,
            // Rows carry no bypass. A writer that must page during maintenance is
            // bound to a configured alert with `bypassMaintenance: true`.
            bypassMaintenance: false,
            held: false,
            details: { component: ref.signal, group: ref.plugin, custom: { origin: 'signal' } },
        });
    }
    return desired;
}
function alertTarget(alert, source, state) {
    const levelsOn = alert.levels.filter((level) => state.levels[(0, model_1.levelKey)(alert.id, level.severity)]?.on === true);
    const row = alert.signal === undefined ? undefined : state.rowsSeen[(0, schema_1.signalRefKey)(alert.signal)];
    const highestOn = (0, model_1.maxSeverity)(levelsOn.map((level) => level.severity));
    // A bound alert follows the last row seen, including when a person turns
    // its switch on by hand. The configured severity applies until a row exists.
    const severity = row?.severity ?? highestOn ?? alert.levels[0]?.severity ?? 'critical';
    const topLevel = levelsOn.find((level) => level.severity === highestOn);
    const changedAt = Math.max(0, ...levelsOn.map((level) => state.levels[(0, model_1.levelKey)(alert.id, level.severity)]?.changedAt ?? 0));
    const custom = { origin: alert.signal === undefined ? 'switch' : 'signal' };
    if (topLevel !== undefined) {
        custom.level = topLevel.name;
    }
    if (row !== undefined) {
        custom.detail = row.summary;
    }
    return {
        key: (0, model_1.alertTargetKey)(alert.id),
        label: alert.name,
        open: levelsOn.length > 0,
        severity,
        dedupKey: (0, model_1.alertDedupKey)(source, alert.id),
        summary: alert.summary,
        changedAt,
        bypassMaintenance: alert.bypassMaintenance,
        held: false,
        details: { component: alert.id, group: settings_1.EVENT_GROUP, custom },
    };
}
function parseRefKey(refKey) {
    const slash = refKey.lastIndexOf('/');
    if (slash <= 0) {
        return undefined;
    }
    return { plugin: refKey.slice(0, slash), signal: refKey.slice(slash + 1) };
}
