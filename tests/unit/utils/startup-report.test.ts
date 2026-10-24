/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { formatStartupReport, resolveAccessories } from '../../../src/utils'
import type { ResolvedAccessory, ResolvedConfig } from '../../../src/types'
import { alert, leveledAlert, resolvedConfig } from '../../helpers/config'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

/** `created` lists accessory names; `renamed` maps a current name to its old one. */
function report(
  config: ResolvedConfig,
  history: { created?: string[]; renamed?: Record<string, string> } = {},
): string[] {
  const accessories = resolveAccessories(config)
  const created = new Set<ResolvedAccessory>()
  const renamed = new Map<ResolvedAccessory, string>()
  for (const accessory of accessories) {
    if (history.created?.includes(accessory.name) === true) {
      created.add(accessory)
    }
    const oldName = history.renamed?.[accessory.name]
    if (oldName !== undefined) {
      renamed.set(accessory, oldName)
    }
  }
  return formatStartupReport({ config, accessories, pluginVersion: '1.2.3', changes: { created, renamed } })
}

describe('formatStartupReport', () => {
  it('reports the platform, one line per alert, and the optional accessories', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      region: 'eu',
      source: 'cabin',
      signalSources: ['homebridge-example', 'homebridge-other'],
      alerts: [
        alert({ bypassMaintenance: true }),
        leveledAlert('freezer', ['warning', 'critical']),
        alert({
          id: 'sump',
          name: 'Sump',
          summary: 'Sump level high',
          levels: [{ severity: 'error', name: 'Sump' }],
          resolveAfterMinutes: 60,
          signal: { plugin: 'homebridge-example', signal: 'sump-high' },
        }),
      ],
      heldAlertIds: ['garage-door'],
      maintenance: { ...base.maintenance, name: 'House Work', maxMinutes: 120 },
      options: { ...base.options, deliveryFaultSensorName: 'Paging Health' },
    })

    expect(report(config)).toEqual([
      'Starting v1.2.3: region EU, source cabin, signal sources 2',
      'Alert switch: leak "Water detected in Zone One" (critical)',
      'Alert switch: freezer "Freezer temperature is high" (warning, critical)',
      'Alert switch: sump "Sump level high" (error)',
      'Alert switch: garage-door held until its entry is fixed; its switches show No Response',
      'Maintenance switch: House Work; turns off after 120 min',
      'Delivery sensor: Paging Health',
    ])
  })

  it('marks new accessories and a dry run', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({ options: { ...base.options, dryRun: true } })

    const lines = report(config, { created: ['Zone One Leak', 'PagerDuty Maintenance', 'PagerDuty Delivery'] })

    expect(lines).toEqual([
      'Starting v1.2.3 (dry run: nothing is sent): region US, source homebridge',
      'Alert switch: leak "Water detected in Zone One" (critical; new)',
      'Maintenance switch: PagerDuty Maintenance (new); turns off after 240 min',
      'Delivery sensor: PagerDuty Delivery (new)',
    ])
  })

  it('names the new switches when only some of an alert\'s levels are new', () => {
    const config = resolvedConfig({ alerts: [leveledAlert('freezer', ['warning', 'critical'])] })

    expect(report(config, { created: ['Freezer critical'] })[1])
      .toBe('Alert switch: freezer "Freezer temperature is high" (warning, critical; new Freezer critical)')
  })

  it('reports renamed accessories with their old names', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      alerts: [alert(), leveledAlert('freezer', ['warning', 'critical'])],
      maintenance: { ...base.maintenance, name: 'House Work' },
      options: { ...base.options, deliveryFaultSensorName: 'Paging Health' },
    })

    const lines = report(config, {
      renamed: {
        'Freezer warning': 'Freezer Warm',
        'Freezer critical': 'Freezer Hot',
        'House Work': 'PagerDuty Maintenance',
        'Paging Health': 'PagerDuty Delivery',
      },
    })

    expect(lines.slice(1)).toEqual([
      'Alert switch: leak "Water detected in Zone One" (critical)',
      'Alert switch: freezer "Freezer temperature is high" (warning, critical; renamed Freezer Warm to Freezer warning, Freezer Hot to Freezer critical)',
      'Maintenance switch: House Work (renamed from PagerDuty Maintenance); turns off after 240 min',
      'Delivery sensor: Paging Health (renamed from PagerDuty Delivery)',
    ])
  })

  it('lists the signals each listed plugin has written, and which ones the alerts follow', () => {
    const config = resolvedConfig({
      signalSources: ['homebridge-example', 'homebridge-quiet'],
      alerts: [
        alert({ id: 'sump', signal: { plugin: 'homebridge-example', signal: 'sump-high' } }),
        alert({ id: 'typo', signal: { plugin: 'homebridge-example', signal: 'sump-hgih' } }),
      ],
    })
    const signalsWritten = new Map([['homebridge-example', ['flood', 'sump-high']]])

    const lines = formatStartupReport({
      config,
      accessories: resolveAccessories(config),
      pluginVersion: '1.2.3',
      changes: { created: new Set(), renamed: new Map() },
      signalsWritten,
    })

    expect(lines).toContain('Signals from homebridge-example: flood, sump-high; followed: sump-high; followed but not written: sump-hgih')
    expect(lines).toContain('Signals from homebridge-quiet: none written yet')
    expect(lines.indexOf('Signals from homebridge-example: flood, sump-high; followed: sump-high; followed but not written: sump-hgih'))
      .toBeLessThan(lines.findIndex((line) => line.startsWith('Maintenance switch:')))
  })

  it('caps a long signal list and leaves signal lines out when the store was not read', () => {
    const config = resolvedConfig({ signalSources: ['homebridge-example'] })
    const names = Array.from({ length: 23 }, (_, index) => `s${String(index).padStart(2, '0')}`)
    const build = (signalsWritten?: Map<string, string[]>): string[] => formatStartupReport({
      config,
      accessories: resolveAccessories(config),
      pluginVersion: '1.2.3',
      changes: { created: new Set(), renamed: new Map() },
      signalsWritten,
    })

    const line = build(new Map([['homebridge-example', names]])).find((entry) => entry.startsWith('Signals from'))
    expect(line).toBe(`Signals from homebridge-example: ${names.slice(0, 20).join(', ')} and 3 more`)
    expect(build().some((entry) => entry.startsWith('Signals from'))).toBe(false)
  })

  it('leaves out accessories that are turned off', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      maintenance: { ...base.maintenance, switch: false },
      options: { ...base.options, deliveryFaultSensor: false },
    })

    expect(report(config)).toEqual([
      'Starting v1.2.3: region US, source homebridge',
      'Alert switch: leak "Water detected in Zone One" (critical)',
    ])
  })

  it('never includes the routing key, and neutralises control characters', () => {
    const base = resolvedConfig()
    const config = resolvedConfig({
      alerts: [alert({ summary: 'Line one\nLine two' })],
      maintenance: { ...base.maintenance, name: 'Odd\u0007Name' },
    })

    const text = report(config).join('\n')

    expect(text).not.toContain(FAKE_ROUTING_KEY)
    expect(text).toContain('Alert switch: leak "Line one\uFFFDLine two" (critical)')
    expect(text).toContain('Maintenance switch: Odd\uFFFDName;')
  })
})
