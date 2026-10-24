/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Keys and dedup keys are an interface with PagerDuty: a change here orphans
 * every open alert, so their shapes are pinned.
 */

import {
  alertDedupKey,
  alertTargetKey,
  levelKey,
  maxSeverity,
  signalDedupKey,
  signalTargetKey,
} from '../../../src/state/model'

describe('keys', () => {
  it('have the documented shapes', () => {
    const ref = { plugin: '@scope/homebridge-example', signal: 'sump-high' }

    expect(levelKey('leak', 'critical')).toBe('leak:critical')
    expect(alertTargetKey('leak')).toBe('alert:leak')
    expect(signalTargetKey(ref)).toBe('signal:@scope/homebridge-example/sump-high')
    expect(alertDedupKey('homebridge', 'leak')).toBe('homebridge/leak')
    expect(signalDedupKey('homebridge', ref)).toBe('homebridge/@scope/homebridge-example/sump-high')
  })

  it('keep the longest signal dedup key within PagerDuty\'s 255', () => {
    const key = signalDedupKey('s'.repeat(32), { plugin: 'p'.repeat(128), signal: 'x'.repeat(64) })

    expect(key.length).toBeLessThanOrEqual(255)
  })
})

describe('maxSeverity', () => {
  it('picks the most severe, or nothing from an empty list', () => {
    expect(maxSeverity([])).toBeUndefined()
    expect(maxSeverity(['warning', 'critical', 'info'])).toBe('critical')
    expect(maxSeverity(['info', 'error'])).toBe('error')
  })
})
