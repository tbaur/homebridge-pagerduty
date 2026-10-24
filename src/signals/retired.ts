/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Naming plugins that still write to a retired signal store.
 *
 * A retired store is one that an earlier version of this plugin read. It is
 * opened read-only and only plugin names are read from it, so a writer that
 * was never updated is named in the log but can never page. `node:sqlite` is
 * loaded only when a retired store exists.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { PLUGIN_NAME, READER_BUSY_TIMEOUT_MS } from '../settings'
import type { PluginLogger } from '../types'
import { describeError } from '../utils/errors'
import { isValidPluginName } from './schema'

/** Most plugin names read from one retired store. */
export const MAX_RETIRED_WRITERS = 20

/** The part of `node:sqlite` this file uses. */
export interface ReadOnlySqliteModule {
  DatabaseSync: new (path: string, options: { readOnly: boolean }) => DatabaseSync
}

/** A retired store that holds rows, and the plugins that wrote them. */
export interface RetiredStoreWriters {
  /** Relative to the Homebridge storage directory, so no home path reaches the log. */
  store: string
  plugins: string[]
}

/** Inputs for {@link findRetiredStoreWriters}. */
export interface FindRetiredStoreWritersInput {
  storageDir: string
  /** Each store's path relative to `storageDir`. */
  stores: readonly string[]
  log: PluginLogger
  loadSqlite?: () => ReadOnlySqliteModule
}

/**
 * The plugins with rows in each retired store that exists. A store that cannot
 * be read is skipped with a `debug` line: this is advice, never a fault.
 */
export function findRetiredStoreWriters(input: FindRetiredStoreWritersInput): RetiredStoreWriters[] {
  const found: RetiredStoreWriters[] = []
  for (const store of input.stores) {
    const path = join(input.storageDir, store)
    if (!existsSync(path)) {
      continue
    }
    try {
      const sqlite = (input.loadSqlite ?? loadNodeSqlite)()
      const plugins = readPluginNames(new sqlite.DatabaseSync(path, { readOnly: true }))
      if (plugins.length > 0) {
        found.push({ store, plugins })
      }
    } catch (error) {
      input.log.debug(`retired signal store ${store} was not read: ${describeError(error)}`)
    }
  }
  return found
}

function readPluginNames(db: DatabaseSync): string[] {
  try {
    db.exec(`PRAGMA busy_timeout = ${READER_BUSY_TIMEOUT_MS}`)
    const rows = db.prepare(`SELECT DISTINCT plugin FROM signals ORDER BY plugin LIMIT ${MAX_RETIRED_WRITERS}`).all()
    return rows
      .map((row) => row.plugin)
      .filter((plugin): plugin is string => isValidPluginName(plugin) && plugin !== PLUGIN_NAME)
  } finally {
    db.close()
  }
}

function loadNodeSqlite(): ReadOnlySqliteModule {
  return process.getBuiltinModule('node:sqlite') as ReadOnlySqliteModule
}
