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
import type { PlatformAccessory } from 'homebridge';
import type { AccessoryContext, ResolvedAccessory } from '../types';
/** A cached context, or undefined when it is unusable. */
export declare function parseAccessoryContext(value: unknown): AccessoryContext | undefined;
/**
 * Write a resolved accessory's identity into its context.
 *
 * Returns the context it wrote, so a caller can use the same object it just
 * persisted rather than reading it back.
 */
export declare function bindAccessoryContext(accessory: PlatformAccessory, resolved: ResolvedAccessory): AccessoryContext;
/**
 * The identity key an accessory's UUID is generated from.
 *
 * Alert id plus severity, never a name. Changing a level's severity therefore
 * creates a new tile, which the README says next to the `levels` setting.
 */
export declare function accessoryIdentityKey(accessory: Pick<ResolvedAccessory, 'kind' | 'alertId' | 'severity'>): string;
