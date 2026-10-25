/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opt-in diagnostics collector.
 *
 * It reads only in-memory state through `readGauges`; it never touches the
 * network and never sees the routing key.
 */

import type { DeliveryGauges, DiagnosticsSnapshot, PagerDutyPlatformConfig } from '../types'

/** Maximum number of recent request latencies retained for percentile math. */
const LATENCY_WINDOW = 200

/** Health classification result. */
export interface HealthRollup {
  health: 'healthy' | 'degraded'
  reasons: string[]
}

interface CollectorOptions {
  pluginVersion: string
  config: PagerDutyPlatformConfig
  now?: () => number
}

/** Accumulates diagnostics counters and renders heartbeat and snapshot reports. */
export class DiagnosticsCollector {
  private readonly now: () => number
  private readonly startedAtMs: number
  private readonly pluginVersion: string
  private readonly configEcho: Record<string, unknown>
  private requests = 0
  private errors = 0
  private readonly latencies: number[] = []
  private marker = { requests: 0, errors: 0 }

  constructor(options: CollectorOptions) {
    this.now = options.now ?? Date.now
    this.startedAtMs = this.now()
    this.pluginVersion = options.pluginVersion
    this.configEcho = redactConfig(options.config)
  }

  /** One Events API request finished. */
  apiRequest(durationMs: number, ok: boolean): void {
    this.requests += 1
    if (!ok) {
      this.errors += 1
    }
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.latencies.push(durationMs)
      if (this.latencies.length > LATENCY_WINDOW) {
        this.latencies.shift()
      }
    }
  }

  /** Nearest-rank percentile (0..100) over the recent-latency window. */
  percentile(p: number): number {
    if (this.latencies.length === 0) {
      return 0
    }
    const sorted = [...this.latencies].sort((left, right) => left - right)
    const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0
  }

  /** Degraded while pages are not going out, PagerDuty is unreachable, or the store is unreadable. */
  rollup(gauges: DeliveryGauges): HealthRollup {
    const reasons: string[] = []
    if (gauges.deliveryFault) {
      reasons.push('deliveryFault')
    }
    if (gauges.outage) {
      reasons.push('pagerDutyUnreachable')
    }
    if (gauges.rejected > 0) {
      reasons.push('eventRejected')
    }
    if (gauges.storeOk === false) {
      reasons.push('signalStoreUnreadable')
    }
    return { health: reasons.length > 0 ? 'degraded' : 'healthy', reasons }
  }

  /** Per-interval request deltas plus absolute gauges. */
  buildHeartbeat(gauges: DeliveryGauges): DiagnosticsSnapshot {
    const report = this.buildReport('health', gauges, {
      requests: this.requests - this.marker.requests,
      errors: this.errors - this.marker.errors,
    })
    this.marker = { requests: this.requests, errors: this.errors }
    return report
  }

  /** Cumulative totals plus the redacted config echo. */
  snapshot(msg: string, gauges: DeliveryGauges): DiagnosticsSnapshot {
    const report = this.buildReport(msg, gauges, { requests: this.requests, errors: this.errors })
    report.config = { ...this.configEcho }
    return report
  }

  private buildReport(
    msg: string,
    gauges: DeliveryGauges,
    counters: { requests: number; errors: number },
  ): DiagnosticsSnapshot {
    const { health, reasons } = this.rollup(gauges)
    return {
      msg,
      lifecycle: {
        health,
        reasons,
        uptimeSec: Math.round((this.now() - this.startedAtMs) / 1_000),
        pluginVersion: this.pluginVersion,
      },
      delivery: { ...gauges },
      api: { p50Ms: this.percentile(50), p95Ms: this.percentile(95), ...counters },
    }
  }
}

/** The routing key and every alert name and summary stay out of the echo. */
function redactConfig(config: PagerDutyPlatformConfig): Record<string, unknown> {
  const options = config.options
  return {
    routingKey: typeof config.routingKey === 'string' && config.routingKey.length > 0,
    region: config.region ?? 'us',
    alerts: Array.isArray(config.alerts) ? config.alerts.length : 0,
    maintenanceSwitch: config.maintenance?.switch === true,
    signalPluginsAllowed: countAllowedPlugins(config.signals),
    deliveryFaultSensor: options?.deliveryFaultSensor !== false,
    dryRun: options?.dryRun === true,
    diagnosticsInterval: options?.diagnosticsInterval ?? 0,
    structuredLogs: options?.structuredLogs === true,
  }
}

function countAllowedPlugins(signals: unknown): number {
  if (typeof signals !== 'object' || signals === null) {
    return 0
  }
  return Object.values(signals).filter((entry: unknown) => (entry as { allow?: unknown } | null)?.allow === true).length
}
