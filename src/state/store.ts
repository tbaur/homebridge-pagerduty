/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Loading and saving the state file.
 *
 * Starting empty is a kind of clear, and a read error is never a clear. So the
 * three ways a load can go are handled differently:
 *
 * - `ENOENT`: first run. Start empty.
 * - Unparseable, or a shape this version does not know: rename the file aside
 *   and start empty. The caller then resolves every key that is desired closed,
 *   so nothing the lost file knew about is left open in PagerDuty.
 * - Any other read error (`EACCES`, `EIO`), or a directory that cannot be
 *   created: throw. The platform disables itself, because starting empty would
 *   hide whatever is wrong with the disk.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from '../settings'
import type { PluginLogger } from '../types'
import { isSeverity } from '../types'
import { writeJsonAtomic } from '../utils/atomic-file'
import { describeError, errorCode, StateUnreadableError } from '../utils/errors'
import type { PersistedState } from './model'
import { emptyState, STATE_VERSION } from './model'

/** Outcome of {@link StateStore.load}. */
export interface LoadResult {
  state: PersistedState
  outcome: 'fresh' | 'loaded' | 'corrupt'
}

/** Construction options for {@link StateStore}. */
export interface StateStoreOptions {
  path: string
  log: PluginLogger
  /**
   * False in `dryRun`: delivered and rejected records stay in memory, and the
   * file keeps the ones it was loaded with, so a dry run never convinces a
   * later real run that something was delivered.
   */
  persistDelivery: boolean
  now?: () => number
  write?: (path: string, value: unknown, mode: number) => Promise<void>
}

/** SHA-256 of the routing key. The only form of the key that is ever persisted. */
export function fingerprintRoutingKey(routingKey: string): string {
  return createHash('sha256').update(routingKey).digest('hex')
}

/** Reads and writes `homebridge-pagerduty/state.json`. */
export class StateStore {
  private readonly options: StateStoreOptions
  private readonly now: () => number
  private readonly write: (path: string, value: unknown, mode: number) => Promise<void>
  private chain: Promise<void> = Promise.resolve()
  private diskDelivery: Pick<PersistedState, 'delivered' | 'rejected'> = { delivered: {}, rejected: {} }

  constructor(options: StateStoreOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.write = options.write ?? writeJsonAtomic
  }

  /** Load the state file. Throws {@link StateUnreadableError}; see the file header. */
  load(): LoadResult {
    try {
      mkdirSync(dirname(this.options.path), { recursive: true, mode: PRIVATE_DIR_MODE })
    } catch (error) {
      throw new StateUnreadableError('state directory could not be created', { cause: error })
    }
    let raw: string
    try {
      raw = readFileSync(this.options.path, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return { state: emptyState(), outcome: 'fresh' }
      }
      throw new StateUnreadableError('state file could not be read', { cause: error })
    }
    const state = parseState(raw)
    if (state === undefined) {
      this.moveAside()
      return { state: emptyState(), outcome: 'corrupt' }
    }
    this.diskDelivery = { delivered: { ...state.delivered }, rejected: { ...state.rejected } }
    return { state, outcome: 'loaded' }
  }

  /**
   * Persist a snapshot. Writes are serialized, so the file always ends up
   * holding the most recent one. Never rejects: a failed write is logged, and
   * the next change writes the whole state again.
   */
  save(state: PersistedState): Promise<void> {
    const snapshot: PersistedState = this.options.persistDelivery
      ? structuredClone(state)
      : { ...structuredClone(state), ...structuredClone(this.diskDelivery) }
    this.chain = this.chain
      .then(() => this.write(this.options.path, snapshot, PRIVATE_FILE_MODE))
      .catch((error: unknown) => {
        this.options.log.error(`state file could not be written: ${describeError(error)}`)
      })
    return this.chain
  }

  /** Resolves once every queued write has finished. */
  flush(): Promise<void> {
    return this.chain
  }

  private moveAside(): void {
    const aside = `${this.options.path}.corrupt-${this.now()}`
    try {
      renameSync(this.options.path, aside)
      this.options.log.warn(`state file was unreadable; moved aside and starting empty: ${aside}`)
    } catch (error) {
      this.options.log.warn(`state file was unreadable and could not be moved aside (${describeError(error)}); starting empty`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTimeOrNull(value: unknown): value is number | null {
  return value === null || isTime(value)
}

function everyValue(value: unknown, check: (entry: Record<string, unknown>) => boolean): boolean {
  return isRecord(value) && Object.values(value).every((entry) => isRecord(entry) && check(entry))
}

/**
 * Parse the state file strictly.
 *
 * One malformed record makes the whole file corrupt. Dropping just that record
 * would quietly forget an open alert; treating the file as corrupt instead
 * triggers the resolve sweep, which is safe.
 */
export function parseState(raw: string): PersistedState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.version !== STATE_VERSION) {
    return undefined
  }
  const { routingKeyFingerprint: fingerprint, maintenance } = parsed
  const valid = (fingerprint === null || typeof fingerprint === 'string')
    && isRecord(maintenance)
    && typeof maintenance.on === 'boolean'
    && isTimeOrNull(maintenance.since)
    && isTimeOrNull(maintenance.until)
    && everyValue(parsed.levels, (entry) => typeof entry.on === 'boolean' && isTime(entry.changedAt))
    && everyValue(parsed.alerts, (entry) => isTimeOrNull(entry.resolveAt))
    && everyValue(parsed.rowsSeen, (entry) => typeof entry.active === 'boolean'
      && isSeverity(entry.severity) && typeof entry.summary === 'string' && isTime(entry.changedAt))
    && everyValue(parsed.delivered, (entry) => typeof entry.dedupKey === 'string'
      && isSeverity(entry.severity) && isTime(entry.openedAt))
    && everyValue(parsed.rejected, (entry) => typeof entry.desiredHash === 'string'
      && isTime(entry.at) && typeof entry.reason === 'string')
  return valid ? parsed as unknown as PersistedState : undefined
}
