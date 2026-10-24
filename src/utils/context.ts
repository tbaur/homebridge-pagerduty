/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Reading and writing accessory context.
 *
 * Homebridge persists `PlatformAccessory.context` to disk and hands it back as
 * `any` on the next start. Everything in it is therefore untrusted input: it
 * may have been written by an older version of this plugin, hand-edited, or
 * restored from a backup.
 */

import type { PlatformAccessory } from 'homebridge'

import type { AccessoryContext, ResolvedAccessory } from '../types'
import { isAccessoryKind, isSeverity } from '../types'
import { newAccessorySerialNumber } from './serial'

/** A cached context, or undefined when it is unusable. */
export function parseAccessoryContext(value: unknown): AccessoryContext | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const context = value as Partial<Record<keyof AccessoryContext, unknown>>
  if (!isAccessoryKind(context.kind)) {
    return undefined
  }
  const parsed: AccessoryContext = {
    kind: context.kind,
    // Regenerated rather than rejected: discarding the accessory would cost
    // the user the room and automations attached to it.
    serialNumber: typeof context.serialNumber === 'string' && context.serialNumber.length > 0
      ? context.serialNumber
      : newAccessorySerialNumber(),
  }
  if (context.kind === 'alert') {
    if (typeof context.alertId !== 'string' || !isSeverity(context.severity)) {
      return undefined
    }
    parsed.alertId = context.alertId
    parsed.severity = context.severity
  }
  return parsed
}

/**
 * Write a resolved accessory's identity into its context.
 *
 * Returns the context it wrote, so a caller can use the same object it just
 * persisted rather than reading it back.
 */
export function bindAccessoryContext(
  accessory: PlatformAccessory,
  resolved: ResolvedAccessory,
): AccessoryContext {
  const existing = parseAccessoryContext(accessory.context)
  const context: AccessoryContext = {
    kind: resolved.kind,
    serialNumber: existing?.serialNumber ?? newAccessorySerialNumber(),
  }
  if (resolved.alertId !== undefined && resolved.severity !== undefined) {
    context.alertId = resolved.alertId
    context.severity = resolved.severity
  }
  Object.assign(accessory.context as Record<string, unknown>, context)
  return context
}

/**
 * The identity key an accessory's UUID is generated from.
 *
 * Alert id plus severity, never a name. Changing a level's severity therefore
 * creates a new tile, which the README says next to the `levels` setting.
 */
export function accessoryIdentityKey(accessory: Pick<ResolvedAccessory, 'kind' | 'alertId' | 'severity'>): string {
  if (accessory.kind === 'alert') {
    return `alert:${accessory.alertId ?? ''}:${accessory.severity ?? ''}`
  }
  return accessory.kind
}
