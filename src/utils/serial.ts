/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opaque HomeKit serial numbers.
 *
 * HomeKit shows SerialNumber in the Home app, so it ends up in screenshots and
 * bug reports. A random value generated once and persisted in accessory
 * context is stable across restarts without disclosing anything.
 */

import { randomUUID } from 'node:crypto'

/** Generate a fresh opaque serial number. */
export function newAccessorySerialNumber(): string {
  return randomUUID()
}
