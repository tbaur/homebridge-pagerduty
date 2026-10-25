#!/usr/bin/env node
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The reference writer from docs/SIGNALS.md, runnable.
 *
 * Self-contained on purpose: a plugin that writes signals must not depend on
 * homebridge-pagerduty (writer rule 7), so this file is what an author copies.
 * The schema below is the published text, and a test asserts the two match.
 *
 * Usage:
 *   node scripts/reference-writer.js --storage DIR --plugin PKG --signal NAME
 *     [--clear] [--severity LEVEL] [--summary TEXT]
 *
 * DIR is the Homebridge storage directory, the one that holds config.json.
 */
const fs = require('node:fs')
const path = require('node:path')

const STORE_DIR = 'homebridge-pagerduty'
// The interface this writer was written for. See "Interface identifier" in docs/SIGNALS.md.
const INTERFACE_ID = 'signals-2026-10-24'
const STORE_FILE = 'signals.sqlite'
const BUSY_TIMEOUT_MS = 1000

const SCHEMA = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS signals (
  plugin     TEXT    NOT NULL CHECK (length(plugin) BETWEEN 1 AND 128 AND plugin NOT GLOB '*[^a-z0-9@/._-]*'),
  signal     TEXT    NOT NULL CHECK (length(signal) BETWEEN 1 AND 64 AND signal NOT GLOB '*[^a-z0-9._-]*'),
  active     INTEGER NOT NULL CHECK (active IN (0, 1)),
  severity   TEXT    NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary    TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 1024),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin, signal)
) STRICT;`

const UPSERT = 'INSERT INTO signals (plugin, signal, active, severity, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
  + 'ON CONFLICT (plugin, signal) DO UPDATE SET active = excluded.active, severity = excluded.severity, '
  + 'summary = excluded.summary, updated_at = excluded.updated_at'

/**
 * Open the store the way every writer must: create its directory and file
 * owner-only, keep the busy timeout short (node:sqlite blocks the process
 * while it waits), and run the published schema.
 */
function openStore(storageDir) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const dir = path.join(storageDir, STORE_DIR, INTERFACE_ID)
  const file = path.join(dir, STORE_FILE)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const db = new DatabaseSync(file)
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    db.exec(SCHEMA)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Upsert one signal. Call it when the condition changes, and once per signal
 * at startup with the current state. `active: false` clears it.
 */
function writeSignal(db, signal) {
  db.prepare(UPSERT).run(
    signal.plugin,
    signal.signal,
    signal.active ? 1 : 0,
    signal.severity,
    signal.summary,
    signal.updatedAt ?? Date.now(),
  )
}

module.exports = { SCHEMA, STORE_DIR, INTERFACE_ID, STORE_FILE, openStore, writeSignal }

if (require.main === module) {
  const { fail, parseFlags, run } = require('./lib/common')
  run(async () => {
    const flags = parseFlags(process.argv.slice(2), {
      storage: 'string', plugin: 'string', signal: 'string', clear: 'boolean', severity: 'string', summary: 'string',
    })
    for (const required of ['storage', 'plugin', 'signal']) {
      if (flags[required] === undefined) {
        fail(`--${required} is required`)
      }
    }
    const db = openStore(flags.storage)
    try {
      writeSignal(db, {
        plugin: flags.plugin,
        signal: flags.signal,
        active: flags.clear !== true,
        severity: flags.severity ?? 'warning',
        summary: flags.summary ?? `${flags.signal} ${flags.clear === true ? 'cleared' : 'raised'}`,
      })
    } finally {
      db.close()
    }
    console.log(`${flags.plugin}/${flags.signal}: ${flags.clear === true ? 'cleared' : 'raised'}`)
  })
}
