/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { parseRetryAfterMs } from '../../../src/utils/retry-after'

const CAP = 900_000

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('120', CAP)).toBe(120_000)
  })

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')

    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:01:00 GMT', CAP, () => now)).toBe(60_000)
  })

  it('treats a date in the past as zero', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')

    expect(parseRetryAfterMs('Wed, 31 Dec 2025 00:00:00 GMT', CAP, () => now)).toBe(0)
  })

  it('clamps to the cap', () => {
    expect(parseRetryAfterMs('86400', CAP)).toBe(CAP)
  })

  it('uses the first of repeated headers', () => {
    expect(parseRetryAfterMs(['5', '60'], CAP)).toBe(5_000)
  })

  it.each([[undefined], [''], ['  '], ['soon'], ['-5']])('ignores %p', (value) => {
    expect(parseRetryAfterMs(value, CAP)).toBeUndefined()
  })
})
