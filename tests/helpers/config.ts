/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration builders. Every name here is a placeholder.
 */

import type { ResolvedAlert, ResolvedConfig, ResolvedSignal, ResolvedSignalPlugin, Severity } from '../../src/types'
import { FAKE_ROUTING_KEY } from './secrets'

/** One alert with a single level, overridable. */
export function alert(overrides: Partial<ResolvedAlert> & { id?: string } = {}): ResolvedAlert {
  const id = overrides.id ?? 'leak'
  return {
    id,
    name: 'Zone One Leak',
    summary: 'Water detected in Zone One',
    levels: [{ severity: 'critical', name: 'Zone One Leak' }],
    resolveAfterMinutes: 0,
    bypassMaintenance: false,
    ...overrides,
  }
}

/** An alert with one level per listed severity. */
export function leveledAlert(id: string, severities: Severity[]): ResolvedAlert {
  return alert({
    id,
    name: 'Freezer',
    summary: 'Freezer temperature is high',
    levels: severities.map((severity) => ({ severity, name: `Freezer ${severity}` })),
  })
}

/** A usable configuration, overridable. */
export function resolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    routingKey: FAKE_ROUTING_KEY,
    region: 'us',
    source: 'homebridge',
    alerts: [alert()],
    heldAlertIds: [],
    maintenance: { switch: true, name: 'PagerDuty Maintenance', maxMinutes: 240 },
    signalPlugins: [],
    options: {
      deliveryFaultSensor: true,
      deliveryFaultSensorName: 'PagerDuty Delivery',
      dryRun: false,
      diagnosticsInterval: 0,
      structuredLogs: false,
    },
    ...overrides,
  }
}

/** One signal's settings, as the validator resolves an untouched entry. Overridable. */
export function signal(overrides: Partial<ResolvedSignal> & { signal?: string } = {}): ResolvedSignal {
  return {
    plugin: 'homebridge-example',
    signal: 'sump-high',
    enabled: true,
    bypassMaintenance: false,
    switch: false,
    switchName: 'Sump High',
    ...overrides,
  }
}

/** An allowed plugin with the given signal settings. */
export function allowedPlugin(plugin: string, signals: ResolvedSignal[] = []): ResolvedSignalPlugin {
  return { plugin, allow: true, signals: signals.map((entry) => ({ ...entry, plugin })) }
}
