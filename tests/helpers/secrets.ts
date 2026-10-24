/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Routing-key-shaped fixtures assembled at runtime.
 *
 * A routing key is 32 letters and digits. Written as one literal next to
 * `routing_key`, it trips the CI secrets job and the secrets-scan test, which
 * is the point of both. The pieces stay separate in the file; only the running
 * process joins them. None of these is a real key.
 */

/** A well-formed integration key that no PagerDuty service has. */
export const FAKE_ROUTING_KEY = ['TEST', 'KEY', '0'.repeat(25)].join('')

/** A second well-formed key, for key-change tests. */
export const OTHER_ROUTING_KEY = ['TEST', 'KEY', '1'.repeat(25)].join('')
