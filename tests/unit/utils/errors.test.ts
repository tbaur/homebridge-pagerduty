/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Error text is the one route by which a request body could reach a log line,
 * and the cause chain is where the useful detail (ENOTFOUND) actually sits.
 */

import {
  ConnectionError,
  describeError,
  errorCode,
  ProtocolError,
  StateUnreadableError,
} from '../../../src/utils/errors'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

describe('describeError', () => {
  it('walks the cause chain and includes system codes', () => {
    const root = Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' })
    const error = new ConnectionError('request failed', { cause: root })

    expect(describeError(error)).toBe('request failed: getaddrinfo failed (ENOTFOUND)')
  })

  it('does not repeat a message or loop on a cyclic chain', () => {
    const error = new Error('same')
    Object.assign(error, { cause: error })

    expect(describeError(new Error('same', { cause: error }))).toBe('same')
  })

  it('describes strings, objects and nothing', () => {
    expect(describeError('plain')).toBe('plain')
    expect(describeError({ a: 1 })).toBe('{"a":1}')
    expect(describeError(undefined)).toBe('unknown error')
    expect(describeError(new Error(''))).toBe('unknown error')
  })

  it('falls back to String for a value JSON cannot encode', () => {
    expect(describeError(BigInt(5))).toBe('5')
  })

  it('removes a key-shaped run from external text', () => {
    expect(describeError(new Error(`bad key ${FAKE_ROUTING_KEY}`))).toBe('bad key [redacted]')
  })

  it('replaces control characters and caps the length', () => {
    const result = describeError(new Error(`a\nb${'x'.repeat(400)}`))

    expect(result.startsWith('a\uFFFDb')).toBe(true)
    expect(result).toHaveLength(301)
  })
})

describe('errorCode', () => {
  it('reads a code from anything that carries one', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errorCode({ code: 'EPERM' })).toBe('EPERM')
  })

  it('is undefined otherwise', () => {
    expect(errorCode(new Error('x'))).toBeUndefined()
    expect(errorCode({ code: '' })).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
    expect(errorCode('ENOENT')).toBeUndefined()
  })
})

describe('error classes', () => {
  it.each([
    [ProtocolError, 'ProtocolError'],
    [ConnectionError, 'ConnectionError'],
    [StateUnreadableError, 'StateUnreadableError'],
  ])('%p carries its name and cause', (Type, name) => {
    const cause = new Error('inner')
    const error = new Type('outer', { cause })

    expect(error.name).toBe(name)
    expect(error.cause).toBe(cause)
  })
})
