/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Anyone holding the routing key can open incidents and page whoever is on
 * call. It travels in every request body, so the places a plugin logs without
 * thinking (an error message, a response body) are the places it would leak.
 */

import { forLog, redactExternal, redactSecrets, REDACTED } from '../../../src/utils/redact'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

describe('redactSecrets', () => {
  it.each([
    ['a JSON body', `{"routing_key":"${FAKE_ROUTING_KEY}","event_action":"trigger"}`, `{"routing_key":${REDACTED},"event_action":"trigger"}`],
    ['JSON with spaces', `{"routingKey" : "${FAKE_ROUTING_KEY}"}`, `{"routingKey" : ${REDACTED}}`],
    ['an environment dump', `PAGERDUTY_ROUTING_KEY=${FAKE_ROUTING_KEY} node smoke.js`, `PAGERDUTY_ROUTING_KEY=${REDACTED} node smoke.js`],
    ['a query string', `?ROUTING_KEY=${FAKE_ROUTING_KEY}&x=1`, `?ROUTING_KEY=${REDACTED}&x=1`],
  ])('removes a key next to its field name in %s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  it('leaves a bare 32-character run alone, because an alert id may look like one', () => {
    const id = 'a'.repeat(32)

    expect(redactSecrets(`alert ${id} switched on`)).toBe(`alert ${id} switched on`)
  })

  it('is a no-op on ordinary text', () => {
    const text = 'Zone One Leak: trigger sent (critical)'

    expect(redactSecrets(text)).toBe(text)
  })
})

describe('redactExternal', () => {
  it('also removes a bare key from text the plugin did not write', () => {
    const result = redactExternal(`Invalid routing key ${FAKE_ROUTING_KEY} for service`)

    expect(result).toBe(`Invalid routing key ${REDACTED} for service`)
  })

  it('leaves runs that are longer or shorter than a key', () => {
    const text = `${'b'.repeat(31)} ${'c'.repeat(33)}`

    expect(redactExternal(text)).toBe(text)
  })
})

describe('forLog', () => {
  it('replaces control characters, so a value cannot forge a log line', () => {
    expect(forLog('Leak\n[ERROR] forged')).toBe('Leak\uFFFD[ERROR] forged')
  })

  it('truncates a long value', () => {
    const result = forLog('x'.repeat(500))

    expect(result).toHaveLength(101)
    expect(result.endsWith('\u2026')).toBe(true)
  })

  it('stringifies a value that is not a string', () => {
    expect(forLog(42)).toBe('42')
  })

  it('redacts a keyed secret in the value', () => {
    expect(forLog(`routing_key=${FAKE_ROUTING_KEY}`)).toBe(`routing_key=${REDACTED}`)
  })
})
