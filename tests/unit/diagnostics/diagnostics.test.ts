/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Diagnostics are opt-in and log-only. What matters is that the health rollup
 * says "degraded" for the conditions a user cares about, and that the config
 * echo never carries the routing key or an alert's text.
 */

import { DiagnosticsCollector } from '../../../src/diagnostics/collector'
import {
  diagnosticLabel,
  formatDiagnosticLine,
  formatHealthTransitionLine,
  formatReasons,
} from '../../../src/diagnostics/format'
import type { DeliveryGauges, PagerDutyPlatformConfig } from '../../../src/types'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

const HEALTHY: DeliveryGauges = {
  openAlerts: 1, pending: 0, heldByMaintenance: 0, rejected: 0, deliveryFault: false, storeOk: null, outage: false,
}

const CONFIG: PagerDutyPlatformConfig = {
  platform: 'PagerDuty',
  routingKey: FAKE_ROUTING_KEY,
  alerts: [{ id: 'leak', name: 'Zone One Leak', summary: 'Water detected' }],
  signals: { sources: ['homebridge-example'] },
  maintenance: { switch: true },
  options: { diagnosticsInterval: 60 },
}

function collector(clock = { now: 0 }): DiagnosticsCollector {
  return new DiagnosticsCollector({ pluginVersion: '1.2.3', config: CONFIG, now: () => clock.now })
}

describe('DiagnosticsCollector', () => {
  it('computes nearest-rank percentiles over recent requests', () => {
    const subject = collector()
    expect(subject.percentile(50)).toBe(0)

    for (const ms of [100, 200, 300, 400, 1_000]) {
      subject.apiRequest(ms, true)
    }
    subject.apiRequest(Number.NaN, false)

    expect(subject.percentile(50)).toBe(300)
    expect(subject.percentile(95)).toBe(1_000)
    expect(subject.percentile(0)).toBe(100)
  })

  it('keeps only the most recent latencies', () => {
    const subject = collector()
    subject.apiRequest(10_000, true)
    for (let index = 0; index < 200; index += 1) {
      subject.apiRequest(1, true)
    }

    expect(subject.percentile(100)).toBe(1)
  })

  it('rolls up each degraded condition', () => {
    expect(collector().rollup(HEALTHY)).toEqual({ health: 'healthy', reasons: [] })
    expect(collector().rollup({ ...HEALTHY, deliveryFault: true, outage: true, rejected: 1, storeOk: false })).toEqual({
      health: 'degraded',
      reasons: ['deliveryFault', 'pagerDutyUnreachable', 'eventRejected', 'signalStoreUnreadable'],
    })
  })

  it('reports per-interval deltas in the heartbeat', () => {
    const clock = { now: 0 }
    const subject = collector(clock)
    subject.apiRequest(10, true)
    subject.apiRequest(10, false)
    clock.now = 61_000

    const first = subject.buildHeartbeat(HEALTHY)
    subject.apiRequest(10, true)
    const second = subject.buildHeartbeat(HEALTHY)

    expect(first.api).toEqual(expect.objectContaining({ requests: 2, errors: 1 }))
    expect(first.lifecycle).toEqual({ health: 'healthy', reasons: [], uptimeSec: 61, pluginVersion: '1.2.3' })
    expect(second.api).toEqual(expect.objectContaining({ requests: 1, errors: 0 }))
    expect(first).not.toHaveProperty('config')
  })

  it('echoes a redacted config on a snapshot', () => {
    const snapshot = collector().snapshot('diagnostics.start', HEALTHY)

    expect(snapshot.config).toEqual({
      routingKey: true,
      region: 'us',
      alerts: 1,
      maintenanceSwitch: true,
      signalSources: 1,
      deliveryFaultSensor: true,
      dryRun: false,
      diagnosticsInterval: 60,
      structuredLogs: false,
    })
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain(FAKE_ROUTING_KEY)
    expect(text).not.toContain('Zone One Leak')
  })

  it('echoes an empty config without failing', () => {
    const subject = new DiagnosticsCollector({ pluginVersion: '1', config: { platform: 'PagerDuty' } })

    expect(subject.snapshot('x', HEALTHY).config).toEqual(expect.objectContaining({ routingKey: false, alerts: 0, signalSources: 0 }))
  })
})

describe('format', () => {
  it('labels known channels and passes others through', () => {
    expect(['health', 'diagnostics.start', 'diagnostics.stop', 'health.degraded', 'health.recovered', 'other'].map(diagnosticLabel))
      .toEqual(['Health', 'Diagnostics start', 'Diagnostics stop', 'Health degraded', 'Health recovered', 'other'])
    expect(formatReasons([])).toBe('')
    expect(formatReasons(['a', 'b'])).toBe(' [a, b]')
  })

  it('renders the health line, with the store only when it is in use', () => {
    const report = collector().buildHeartbeat(HEALTHY)

    expect(formatDiagnosticLine(report)).toBe('Health: healthy | open 1 | pending 0 | held 0 | api p50 0ms p95 0ms (req 0, err 0)')
    expect(formatDiagnosticLine({ ...report, delivery: { ...HEALTHY, storeOk: true } })).toContain('| store ok |')
    expect(formatDiagnosticLine({ ...report, delivery: { ...HEALTHY, storeOk: false } })).toContain('| store unreadable |')
  })

  it('renders a transition as the state alone', () => {
    const report = collector().buildHeartbeat({ ...HEALTHY, outage: true })

    expect(formatHealthTransitionLine({ ...report, msg: 'health.degraded' })).toBe('Health degraded: degraded [pagerDutyUnreachable]')
  })
})
