/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Human-readable formatting for diagnostics reports.
 */

import type { DiagnosticsSnapshot } from '../types'

/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
export function diagnosticLabel(msg: string): string {
  switch (msg) {
    case 'health':
      return 'Health'
    case 'diagnostics.start':
      return 'Diagnostics start'
    case 'diagnostics.stop':
      return 'Diagnostics stop'
    case 'health.degraded':
      return 'Health degraded'
    case 'health.recovered':
      return 'Health recovered'
    default:
      return msg
  }
}

/** Render the bracketed reason list shown after the health state. */
export function formatReasons(reasons: string[]): string {
  return reasons.length > 0 ? ` [${reasons.join(', ')}]` : ''
}

/**
 * Concise summary:
 * `Health: healthy | open 1 | pending 0 | held 0 | store ok | api p50 120ms p95 300ms (req 3, err 0)`.
 */
export function formatDiagnosticLine(report: DiagnosticsSnapshot): string {
  const { lifecycle, delivery, api } = report
  const parts = [
    `${diagnosticLabel(report.msg)}: ${lifecycle.health}${formatReasons(lifecycle.reasons)}`,
    `open ${delivery.openAlerts}`,
    `pending ${delivery.pending}`,
    `held ${delivery.heldByMaintenance}`,
  ]
  if (delivery.storeOk !== null) {
    parts.push(`store ${delivery.storeOk ? 'ok' : 'unreadable'}`)
  }
  parts.push(`api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms (req ${api.requests}, err ${api.errors})`)
  return parts.join(' | ')
}

/** State-only line for a healthy/degraded flip. The heartbeat already has the body. */
export function formatHealthTransitionLine(report: DiagnosticsSnapshot): string {
  return `${diagnosticLabel(report.msg)}: ${report.lifecycle.health}${formatReasons(report.lifecycle.reasons)}`
}
