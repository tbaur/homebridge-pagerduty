"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The persisted state, its keys, and the desired-state type the
 * reconciler compares against it.
 *
 * Two states, both persisted. **Desired**: for each alert, whether it should be
 * open and at what severity, derived from the switches, the signal rows, the
 * resolve timers and the maintenance switch. **Delivered**: what PagerDuty has
 * accepted, written only after a `2xx`. One sender closes the gap between
 * them. Restart, outage and maintenance then need no rules of their own.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_VERSION = void 0;
exports.emptyState = emptyState;
exports.levelKey = levelKey;
exports.alertTargetKey = alertTargetKey;
exports.signalTargetKey = signalTargetKey;
exports.alertDedupKey = alertDedupKey;
exports.signalDedupKey = signalDedupKey;
exports.maxSeverity = maxSeverity;
exports.heldTarget = heldTarget;
const types_1 = require("../types");
/** Bumped only for a change an older version cannot read. */
exports.STATE_VERSION = 1;
/** A state with nothing in it: first run, or after a corrupt file. */
function emptyState() {
    return {
        version: exports.STATE_VERSION,
        routingKeyFingerprint: null,
        levels: {},
        alerts: {},
        maintenance: { on: false, since: null, until: null },
        rowsSeen: {},
        delivered: {},
        rejected: {},
    };
}
/** Key for one level switch. */
function levelKey(alertId, severity) {
    return `${alertId}:${severity}`;
}
/** Target key for a configured alert. */
function alertTargetKey(alertId) {
    return `alert:${alertId}`;
}
/** Target key for an unbound signal row. */
function signalTargetKey(ref) {
    return `signal:${ref.plugin}/${ref.signal}`;
}
/** `dedup_key` for an alert: `<source>/<alertId>`. */
function alertDedupKey(source, alertId) {
    return `${source}/${alertId}`;
}
/**
 * `dedup_key` for an unbound row: `<source>/<plugin>/<signal>`.
 *
 * An alert id cannot contain `/`, so the two forms cannot collide. At most
 * 32 + 1 + 128 + 1 + 64 = 226 characters, under PagerDuty's 255.
 */
function signalDedupKey(source, ref) {
    return `${source}/${ref.plugin}/${ref.signal}`;
}
/** The highest severity in a list, or undefined for an empty one. */
function maxSeverity(severities) {
    let best;
    for (const severity of severities) {
        if (best === undefined || (0, types_1.severityRank)(severity) > (0, types_1.severityRank)(best)) {
            best = severity;
        }
    }
    return best;
}
/** A placeholder target for a held alert. Only `held` is read. */
function heldTarget(key, label) {
    return {
        key,
        label,
        open: false,
        severity: types_1.SEVERITIES[0],
        dedupKey: '',
        summary: '',
        changedAt: 0,
        bypassMaintenance: false,
        held: true,
        details: { component: '', group: '', custom: {} },
    };
}
