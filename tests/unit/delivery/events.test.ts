/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The wire format is PagerDuty's, not ours. These tests pin each field the
 * Events API v2 documentation requires, and the status classes the sender
 * acts on.
 */

import { buildEvent, classifyStatus, rejectionReason } from '../../../src/delivery/events'
import type { ResolveAction, TriggerAction } from '../../../src/state/reconcile'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

const TRIGGER: TriggerAction = {
  kind: 'trigger',
  key: 'alert:leak',
  label: 'Leak',
  dedupKey: 'homebridge/leak',
  severity: 'critical',
  summary: 'Water detected',
  timestamp: Date.parse('2026-01-01T00:00:00Z'),
  details: { component: 'leak', group: 'homebridge-pagerduty', custom: { origin: 'switch', level: 'Leak' } },
  hash: 'h',
}

const RESOLVE: ResolveAction = { kind: 'resolve', key: 'alert:leak', label: 'Leak', dedupKey: 'homebridge/leak', hash: 'h' }

describe('buildEvent', () => {
  it('builds a trigger with every required field', () => {
    expect(buildEvent(TRIGGER, { routingKey: FAKE_ROUTING_KEY, source: 'homebridge' })).toEqual({
      routing_key: FAKE_ROUTING_KEY,
      event_action: 'trigger',
      dedup_key: 'homebridge/leak',
      client: 'Homebridge',
      payload: {
        summary: 'Water detected',
        source: 'homebridge',
        severity: 'critical',
        timestamp: '2026-01-01T00:00:00.000Z',
        component: 'leak',
        group: 'homebridge-pagerduty',
        custom_details: { origin: 'switch', level: 'Leak' },
      },
    })
  })

  it('uses the send time when the change time is unknown', () => {
    const body = buildEvent({ ...TRIGGER, timestamp: 0 }, { routingKey: FAKE_ROUTING_KEY, source: 'homebridge' })

    expect(body.event_action === 'trigger' && Date.parse(body.payload.timestamp)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('builds a resolve with only the key and dedup key', () => {
    expect(buildEvent(RESOLVE, { routingKey: FAKE_ROUTING_KEY, source: 'homebridge' })).toEqual({
      routing_key: FAKE_ROUTING_KEY,
      event_action: 'resolve',
      dedup_key: 'homebridge/leak',
    })
  })
})

describe('classifyStatus', () => {
  it.each([
    [200, 'delivered'], [202, 'delivered'], [299, 'delivered'],
    [408, 'rateLimited'], [429, 'rateLimited'],
    [400, 'rejected'], [401, 'rejected'], [404, 'rejected'], [413, 'rejected'],
    [301, 'retry'], [500, 'retry'], [503, 'retry'], [0, 'retry'], [100, 'retry'],
  ])('classifies %p as %p', (code, expected) => {
    expect(classifyStatus(code)).toBe(expected)
  })
})

describe('rejectionReason', () => {
  it('reads PagerDuty\'s message and error list', () => {
    const body = JSON.stringify({ status: 'invalid event', message: 'Event object is invalid', errors: ['Length of \'summary\' is incorrect'] })

    expect(rejectionReason(400, body)).toBe('HTTP 400: Event object is invalid: Length of \'summary\' is incorrect')
  })

  it('falls back to the raw body, redacted', () => {
    expect(rejectionReason(400, `bad ${FAKE_ROUTING_KEY}`)).toBe('HTTP 400: bad [redacted]')
  })

  it('says only the status for an empty body', () => {
    expect(rejectionReason(404, '')).toBe('HTTP 404')
    expect(rejectionReason(400, '{}')).toBe('HTTP 400')
  })
})
