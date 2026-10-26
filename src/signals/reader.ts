/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Reading the signal store.
 *
 * `node:sqlite` is loaded only once the store file exists, so a user with no
 * plugin that writes signals never loads it (or sees its ExperimentalWarning on
 * Node 22). `DatabaseSync` is synchronous, so every call here blocks the bridge
 * process; the busy timeout is short and a busy store skips the poll.
 *
 * Rules this file enforces:
 * - The allowlist is applied in the query, so rows from other writers can never
 *   push allowed rows past the read cap.
 * - Rows from plugins that are not allowed are read only as names and text for
 *   the settings screen, never as signals.
 * - A read error is never a clear. Missing, busy and corrupt all report
 *   `unavailable`, and the caller keeps the last rows it saw.
 * - Each poll `stat`s the file. A new device or inode number means the file was
 *   replaced, and an old connection would keep reading the deleted one.
 */

import { chmodSync, closeSync, mkdirSync, openSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'

import {
  MAX_CATALOG_ROWS,
  MAX_CATALOG_SCAN_ROWS,
  MAX_SIGNAL_ROWS,
  PLUGIN_NAME,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  READER_BUSY_TIMEOUT_MS,
} from '../settings'
import type { CatalogEntry, PluginLogger, SignalRow } from '../types'
import { describeError, errorCode } from '../utils/errors'
import { SIGNAL_SCHEMA_SQL, validateCatalogEntry, validateRow } from './schema'

/** The part of `node:sqlite` this file uses. */
export interface SqliteModule {
  DatabaseSync: new (path: string) => DatabaseSync
}

/** Outcome of one poll. */
export type PollResult =
  | { kind: 'unchanged' }
  | { kind: 'rows'; rows: SignalRow[]; complete: boolean; catalog: CatalogEntry[]; invalidRows: number }
  | { kind: 'unavailable'; reason: string }

/** Construction options for {@link SignalReader}. */
export interface SignalReaderOptions {
  path: string
  /** Plugins whose rows are read as signals. */
  allowed: readonly string[]
  log: PluginLogger
  loadSqlite?: () => SqliteModule
  platform?: typeof process.platform
}

interface Connection {
  db: DatabaseSync
  dev: number
  ino: number
  /** Undefined when no plugin is allowed, because `IN ()` is not valid SQL. */
  rows: StatementSync | undefined
  catalog: StatementSync
  dataVersion: StatementSync
  lastDataVersion: number | undefined
}

function loadNodeSqlite(): SqliteModule {
  return process.getBuiltinModule('node:sqlite') as SqliteModule
}

/** Polls the signal store for allowlisted rows. */
export class SignalReader {
  private readonly options: SignalReaderOptions
  private connection: Connection | undefined
  private sqlite: SqliteModule | undefined

  constructor(options: SignalReaderOptions) {
    this.options = options
  }

  /**
   * Create the store if needed and open it, so writers usually find it ready.
   *
   * The file is created with owner-only mode before SQLite touches it, because
   * SQLite gives the `-wal` and `-shm` files the main file's mode.
   */
  create(): void {
    mkdirSync(dirname(this.options.path), { recursive: true, mode: PRIVATE_DIR_MODE })
    closeSync(openSync(this.options.path, 'a', PRIVATE_FILE_MODE))
    this.reopen()
  }

  /** Read the allowlisted rows if anything changed since the last poll. */
  poll(): PollResult {
    let stats: { dev: number; ino: number }
    try {
      stats = statSync(this.options.path)
    } catch (error) {
      this.close()
      return { kind: 'unavailable', reason: errorCode(error) === 'ENOENT' ? 'missing' : describeError(error) }
    }
    try {
      if (this.connection === undefined || this.connection.dev !== stats.dev || this.connection.ino !== stats.ino) {
        this.reopen()
      }
      return this.read(this.requireConnection())
    } catch (error) {
      if (!isBusy(error)) {
        this.close()
      }
      return { kind: 'unavailable', reason: isBusy(error) ? 'busy' : describeError(error) }
    }
  }

  /** Close the connection. Safe to call twice. */
  close(): void {
    const connection = this.connection
    this.connection = undefined
    try {
      connection?.db.close()
    } catch (error) {
      this.options.log.debug(`signal store close failed: ${describeError(error)}`)
    }
  }

  private requireConnection(): Connection {
    if (this.connection === undefined) {
      throw new Error('signal store is not open')
    }
    return this.connection
  }

  private reopen(): void {
    this.close()
    this.sqlite ??= (this.options.loadSqlite ?? loadNodeSqlite)()
    const db = new this.sqlite.DatabaseSync(this.options.path)
    try {
      // Set explicitly: the constructor's `timeout` option only exists from
      // Node 22.16, and the floor is 22.13.
      db.exec(`PRAGMA busy_timeout = ${READER_BUSY_TIMEOUT_MS}`)
      db.exec(SIGNAL_SCHEMA_SQL)
      this.tightenModes()
      const placeholders = this.options.allowed.map(() => '?').join(', ')
      const stats = statSync(this.options.path)
      this.connection = {
        db,
        dev: stats.dev,
        ino: stats.ino,
        rows: this.options.allowed.length === 0 ? undefined : db.prepare(
          'SELECT plugin, signal, active, severity, summary, updated_at FROM signals '
          + `WHERE plugin IN (${placeholders}) ORDER BY updated_at DESC LIMIT ${MAX_SIGNAL_ROWS + 1}`,
        ),
        catalog: db.prepare(
          'SELECT plugin, signal, severity, summary FROM signals WHERE plugin <> ? '
          + `ORDER BY plugin, signal LIMIT ${MAX_CATALOG_SCAN_ROWS}`,
        ),
        dataVersion: db.prepare('PRAGMA data_version'),
        lastDataVersion: undefined,
      }
    } catch (error) {
      db.close()
      throw error
    }
  }

  private read(connection: Connection): PollResult {
    const version = Number((connection.dataVersion.get() as { data_version?: unknown } | undefined)?.data_version)
    if (connection.lastDataVersion !== undefined && version === connection.lastDataVersion) {
      return { kind: 'unchanged' }
    }
    const raw = (connection.rows?.all(...this.options.allowed) ?? []) as Record<string, unknown>[]
    const rows: SignalRow[] = []
    let invalidRows = 0
    for (const entry of raw.slice(0, MAX_SIGNAL_ROWS)) {
      const row = validateRow(entry)
      if (row === undefined) {
        invalidRows += 1
      } else {
        rows.push(row)
      }
    }
    const catalog = (connection.catalog.all(PLUGIN_NAME) as Record<string, unknown>[])
      .map(validateCatalogEntry)
      .filter((entry): entry is CatalogEntry => entry !== undefined)
      .slice(0, MAX_CATALOG_ROWS)
    connection.lastDataVersion = version
    return { kind: 'rows', rows, complete: raw.length <= MAX_SIGNAL_ROWS, catalog, invalidRows }
  }

  /** Owner-only on POSIX systems, for the main file and SQLite's two side files. */
  private tightenModes(): void {
    if ((this.options.platform ?? process.platform) === 'win32') {
      return
    }
    for (const file of [this.options.path, `${this.options.path}-wal`, `${this.options.path}-shm`]) {
      try {
        if ((statSync(file).mode & 0o077) !== 0) {
          chmodSync(file, PRIVATE_FILE_MODE)
          this.options.log.info(`tightened ${file} to owner-only`)
        }
      } catch {
        // The side files exist only while a connection is open.
      }
    }
  }
}

function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { errcode?: unknown } | undefined)?.errcode
  return code === 5 || code === 6 || /database is (?:locked|busy)/i.test(message)
}
