"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Human-readable formatting for diagnostics reports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosticLabel = diagnosticLabel;
exports.formatReasons = formatReasons;
exports.formatDiagnosticLine = formatDiagnosticLine;
exports.formatHealthTransitionLine = formatHealthTransitionLine;
/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
function diagnosticLabel(msg) {
    switch (msg) {
        case 'health':
            return 'Health';
        case 'diagnostics.start':
            return 'Diagnostics start';
        case 'diagnostics.stop':
            return 'Diagnostics stop';
        case 'health.degraded':
            return 'Health degraded';
        case 'health.recovered':
            return 'Health recovered';
        default:
            return msg;
    }
}
/** Render the bracketed reason list shown after the health state. */
function formatReasons(reasons) {
    return reasons.length > 0 ? ` [${reasons.join(', ')}]` : '';
}
/**
 * Concise summary:
 * `Health: healthy | open 1 | pending 0 | held 0 | store ok | api p50 120ms p95 300ms (req 3, err 0)`.
 */
function formatDiagnosticLine(report) {
    const { lifecycle, delivery, api } = report;
    const parts = [
        `${diagnosticLabel(report.msg)}: ${lifecycle.health}${formatReasons(lifecycle.reasons)}`,
        `open ${delivery.openAlerts}`,
        `pending ${delivery.pending}`,
        `held ${delivery.heldByMaintenance}`,
    ];
    if (delivery.storeOk !== null) {
        parts.push(`store ${delivery.storeOk ? 'ok' : 'unreadable'}`);
    }
    parts.push(`api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms (req ${api.requests}, err ${api.errors})`);
    return parts.join(' | ');
}
/** State-only line for a healthy/degraded flip. The heartbeat already has the body. */
function formatHealthTransitionLine(report) {
    return `${diagnosticLabel(report.msg)}: ${report.lifecycle.health}${formatReasons(report.lifecycle.reasons)}`;
}
