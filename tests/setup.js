/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Test setup file - runs before all tests.
 *
 * Fails fast if the suite is run without NODE_ENV=test.
 *
 * Also fails fast if a real PagerDuty integration key is present in the
 * environment. The suite never sends an event. Every test drives a stand-in
 * transport. A half-finished test that reached for `process.env` would
 * otherwise page a real person from a `npm test` run.
 */

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Tests must run with NODE_ENV=test. Use: NODE_ENV=test npm test')
}

for (const name of ['PAGERDUTY_ROUTING_KEY']) {
  if (process.env[name] !== undefined) {
    throw new Error(
      `${name} is set. The test suite must not run with a real integration key in the `
      + 'environment; unset it and run again.',
    )
  }
}

// Mock lifecycle and the per-test timeout are both configured once in
// jest.config.js; repeating either here only obscures where it happens.
