"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared types for configuration, accessory identity, signals
 * and diagnostics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESSORY_KINDS = exports.SEVERITIES = void 0;
exports.isSeverity = isSeverity;
exports.severityRank = severityRank;
exports.isAccessoryKind = isAccessoryKind;
/**
 * PagerDuty severities, lowest first. Case-sensitive on the wire.
 *
 * The order is load-bearing: an alert's severity is the highest of its levels
 * that are on, and PagerDuty never lowers an alert, so neither does the plugin.
 */
exports.SEVERITIES = ['info', 'warning', 'error', 'critical'];
/** Narrow an unknown value to a {@link Severity}. */
function isSeverity(value) {
    return typeof value === 'string' && exports.SEVERITIES.includes(value);
}
/** Position in {@link SEVERITIES}; higher is more severe. */
function severityRank(severity) {
    return exports.SEVERITIES.indexOf(severity);
}
// --- Accessories ---------------------------------------------------------------
/** What an accessory is. Part of its identity, and therefore of its UUID. */
exports.ACCESSORY_KINDS = ['alert', 'maintenance', 'delivery'];
/** Narrow an unknown value to an {@link AccessoryKind}. */
function isAccessoryKind(value) {
    return typeof value === 'string' && exports.ACCESSORY_KINDS.includes(value);
}
