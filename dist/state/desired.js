"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Desired state, derived from configuration and persisted state.
 *
 * Pure. Every rule about alerts, levels and signals lives here: an alert is
 * open while any level is on, its severity is the highest level that is on,
 * and a signal follows its switch when it has one and its row when it does not.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDesired = computeDesired;
const config_1 = require("../signals/config");
const schema_1 = require("../signals/schema");
const settings_1 = require("../settings");
const model_1 = require("./model");
/** Every target that should exist, by target key. Absent means "should be closed". */
function computeDesired(config, state) {
    const desired = new Map();
    for (const alert of config.alerts) {
        desired.set((0, model_1.alertTargetKey)(alert.id), alertTarget(alert, config.source, state));
    }
    for (const id of config.heldAlertIds) {
        desired.set((0, model_1.alertTargetKey)(id), (0, model_1.heldTarget)((0, model_1.alertTargetKey)(id), id));
    }
    for (const refKey of signalRefKeys(config, state)) {
        const ref = (0, schema_1.parseSignalRef)(refKey);
        const settings = ref === undefined ? undefined : (0, config_1.signalSettings)(config, ref);
        if (settings?.enabled === true) {
            const target = signalTarget(settings, config.source, state);
            desired.set(target.key, target);
        }
    }
    return desired;
}
/** Signals with a row from an allowed plugin, plus signals with a switch but no row yet. */
function signalRefKeys(config, state) {
    const allowed = (0, config_1.allowedPlugins)(config);
    const keys = new Set(Object.keys(state.rowsSeen).filter((key) => allowed.includes(key.slice(0, key.lastIndexOf('/')))));
    for (const signal of (0, config_1.signalSwitches)(config)) {
        keys.add((0, schema_1.signalRefKey)(signal));
    }
    return keys;
}
function signalTarget(settings, source, state) {
    const refKey = (0, schema_1.signalRefKey)(settings);
    const row = state.rowsSeen[refKey];
    const open = settings.switch ? (0, model_1.isSignalSwitchOn)(state, refKey) : row?.active ?? false;
    const custom = { origin: open && row?.active !== true ? 'switch' : 'signal' };
    if (settings.summary !== undefined && row !== undefined && row.summary !== settings.summary) {
        custom.detail = row.summary;
    }
    return {
        key: (0, model_1.signalTargetKey)(settings),
        label: refKey,
        open,
        severity: settings.severity ?? row?.severity ?? 'critical',
        dedupKey: (0, model_1.signalDedupKey)(source, settings),
        summary: settings.summary ?? row?.summary ?? settings.switchName,
        changedAt: (settings.switch ? state.switches[refKey]?.changedAt : undefined) ?? row?.changedAt ?? 0,
        bypassMaintenance: settings.bypassMaintenance,
        held: false,
        details: { component: settings.signal, group: settings.plugin, custom },
    };
}
function alertTarget(alert, source, state) {
    const levelsOn = alert.levels.filter((level) => state.levels[(0, model_1.levelKey)(alert.id, level.severity)]?.on === true);
    const highestOn = (0, model_1.maxSeverity)(levelsOn.map((level) => level.severity));
    const severity = highestOn ?? alert.levels[0]?.severity ?? 'critical';
    const topLevel = levelsOn.find((level) => level.severity === highestOn);
    const changedAt = Math.max(0, ...levelsOn.map((level) => state.levels[(0, model_1.levelKey)(alert.id, level.severity)]?.changedAt ?? 0));
    const custom = { origin: 'switch' };
    if (topLevel !== undefined) {
        custom.level = topLevel.name;
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
