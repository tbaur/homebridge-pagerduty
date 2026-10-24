/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SqliteModule } from '../../../src/signals/reader'
import { findRetiredStoreWriters, MAX_RETIRED_WRITERS } from '../../../src/signals/retired'
import { fakeLogger } from '../../helpers/hap'

const sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule
const STORE = 'homebridge-pagerduty/signals.sqlite'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-retired-'))
  mkdirSync(join(dir, 'homebridge-pagerduty'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A store with no CHECK constraints, so it can hold names a real writer could not. */
function writeStore(plugins: string[]): void {
  const db = new sqlite.DatabaseSync(join(dir, STORE))
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE signals (plugin TEXT, signal TEXT)')
  for (const plugin of plugins) {
    db.prepare('INSERT INTO signals VALUES (?, ?)').run(plugin, 'door')
  }
  db.close()
}

describe('findRetiredStoreWriters', () => {
  it('returns nothing, and loads no SQLite, when no retired store exists', () => {
    const loadSqlite = jest.fn()

    expect(findRetiredStoreWriters({ storageDir: dir, stores: [STORE], log: fakeLogger(), loadSqlite })).toEqual([])
    expect(loadSqlite).not.toHaveBeenCalled()
  })

  it('names each plugin once, leaving out invalid names and this plugin', () => {
    writeStore(['homebridge-other', 'homebridge-example', 'homebridge-example', 'Bad Name', 'homebridge-pagerduty'])

    expect(findRetiredStoreWriters({ storageDir: dir, stores: [STORE], log: fakeLogger() })).toEqual([
      { store: STORE, plugins: ['homebridge-example', 'homebridge-other'] },
    ])
  })

  it('reads at most a fixed number of names', () => {
    writeStore(Array.from({ length: MAX_RETIRED_WRITERS + 5 }, (_unused, index) => `homebridge-example-${String(index).padStart(2, '0')}`))

    const [found] = findRetiredStoreWriters({ storageDir: dir, stores: [STORE], log: fakeLogger() })

    expect(found?.plugins).toHaveLength(MAX_RETIRED_WRITERS)
  })

  it('opens the store read-only, so it never changes it', () => {
    writeStore(['homebridge-example'])
    const before = readFileSync(join(dir, STORE))

    findRetiredStoreWriters({ storageDir: dir, stores: [STORE], log: fakeLogger() })

    expect(readFileSync(join(dir, STORE)).equals(before)).toBe(true)
  })

  it('skips an empty or unreadable store with a debug line', () => {
    writeFileSync(join(dir, STORE), 'not a database')
    const log = fakeLogger()

    expect(findRetiredStoreWriters({ storageDir: dir, stores: [STORE], log })).toEqual([])
    expect(log.lines('debug')).toEqual([expect.stringMatching(/^retired signal store homebridge-pagerduty\/signals\.sqlite was not read: /)])
    expect(existsSync(join(dir, STORE))).toBe(true)
  })
})
