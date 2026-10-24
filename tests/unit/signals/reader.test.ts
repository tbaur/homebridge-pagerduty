/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Driven against real `node:sqlite`, because the properties that matter are
 * SQLite's: a write from another process becomes visible, `data_version`
 * moves, a replaced file is noticed, and a read error is never a clear.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { SIGNAL_SCHEMA_SQL } from '../../../src/signals/schema'
import { SignalReader, type PollResult, type SqliteModule } from '../../../src/signals/reader'
import { fakeLogger } from '../../helpers/hap'

const sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule

let dir: string
let path: string
let readers: SignalReader[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-signals-'))
  path = join(dir, 'signals.sqlite')
  readers = []
})

afterEach(() => {
  for (const reader of readers) {
    reader.close()
  }
  rmSync(dir, { recursive: true, force: true })
})

function reader(options: Partial<ConstructorParameters<typeof SignalReader>[0]> = {}): SignalReader {
  const created = new SignalReader({ path, allowed: ['homebridge-example'], log: fakeLogger(), ...options })
  readers.push(created)
  return created
}

/** A writer as another plugin would open it: the published schema, then an upsert. */
function write(rows: { plugin?: string; signal: string; active: 0 | 1; severity?: string; summary?: string; at?: number }[]): void {
  const db = new sqlite.DatabaseSync(path)
  try {
    db.exec(SIGNAL_SCHEMA_SQL)
    const upsert = db.prepare(
      'INSERT INTO signals (plugin, signal, active, severity, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT (plugin, signal) DO UPDATE SET active = excluded.active, severity = excluded.severity, '
      + 'summary = excluded.summary, updated_at = excluded.updated_at',
    )
    for (const row of rows) {
      upsert.run(row.plugin ?? 'homebridge-example', row.signal, row.active, row.severity ?? 'warning', row.summary ?? 'Door open', row.at ?? 1)
    }
  } finally {
    db.close()
  }
}

function rowsOf(result: PollResult): Extract<PollResult, { kind: 'rows' }> {
  if (result.kind !== 'rows') {
    throw new Error(`expected rows, got ${JSON.stringify(result)}`)
  }
  return result
}

describe('SignalReader', () => {
  it('reports a store that does not exist yet as missing', () => {
    expect(reader().poll()).toEqual({ kind: 'unavailable', reason: 'missing' })
  })

  it('creates the store owner-only and reads it empty', () => {
    const subject = reader()
    subject.create()

    expect(rowsOf(subject.poll())).toEqual({ kind: 'rows', rows: [], complete: true, catalog: [], invalidRows: 0 })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('creates a missing parent directory owner-only', () => {
    const nested = join(dir, 'homebridge-pagerduty', 'signals.sqlite')
    reader({ path: nested }).create()

    expect(statSync(nested).isFile()).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'homebridge-pagerduty')).mode & 0o777).toBe(0o700)
    }
  })

  it('reads rows only when something changed', () => {
    const subject = reader()
    subject.create()
    write([{ signal: 'door', active: 1, at: 10 }])

    expect(rowsOf(subject.poll()).rows).toEqual([
      { plugin: 'homebridge-example', signal: 'door', active: true, severity: 'warning', summary: 'Door open', updatedAt: 10 },
    ])
    expect(subject.poll()).toEqual({ kind: 'unchanged' })
  })

  it('sees a write from another process', () => {
    const subject = reader()
    subject.create()
    subject.poll()
    const script = [
      `const { DatabaseSync } = process.getBuiltinModule('node:sqlite')`,
      `const db = new DatabaseSync(${JSON.stringify(path)})`,
      `db.exec(${JSON.stringify(SIGNAL_SCHEMA_SQL)})`,
      `db.prepare("INSERT INTO signals VALUES ('homebridge-example', 'sump-high', 1, 'error', 'Level high', 20)").run()`,
      'db.close()',
    ].join('\n')
    execFileSync(process.execPath, ['--no-warnings', '-e', script])

    expect(rowsOf(subject.poll()).rows.map((row) => row.signal)).toEqual(['sump-high'])
  })

  it('applies the allowlist in the query, and lists every plugin\'s signals except its own', () => {
    const subject = reader()
    subject.create()
    write([
      { signal: 'door', active: 1 },
      { plugin: 'homebridge-other', signal: 'x', active: 0, summary: 'Other text' },
      { plugin: 'homebridge-pagerduty', signal: 'self', active: 1 },
    ])

    const result = rowsOf(subject.poll())

    expect(result.rows.map((row) => row.plugin)).toEqual(['homebridge-example'])
    expect(result.catalog).toEqual([
      { plugin: 'homebridge-example', signal: 'door', summary: 'Door open' },
      { plugin: 'homebridge-other', signal: 'x', summary: 'Other text' },
    ])
  })

  it('reads only the list of signals when no plugin is allowed', () => {
    const subject = reader({ allowed: [] })
    write([{ signal: 'door', active: 1 }])

    const result = rowsOf(subject.poll())

    expect(result.rows).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.catalog).toEqual([{ plugin: 'homebridge-example', signal: 'door', summary: 'Door open' }])
  })

  it('reopens when the file is replaced, instead of reading the deleted one', () => {
    const subject = reader()
    subject.create()
    write([{ signal: 'old', active: 1 }])
    subject.poll()

    unlinkSync(path)
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${path}${suffix}`, { force: true })
    }
    write([{ signal: 'new', active: 1 }])

    expect(rowsOf(subject.poll()).rows.map((row) => row.signal)).toEqual(['new'])
  })

  it('says a read of exactly the cap is complete', () => {
    const subject = reader()
    subject.create()
    write(Array.from({ length: 1_000 }, (_unused, index) => ({ signal: `s${index}`, active: 1 as const, at: index })))

    const result = rowsOf(subject.poll())

    expect(result.rows).toHaveLength(1_000)
    expect(result.complete).toBe(true)
  })

  it('fills the list of signals with valid rows, so rows that fail validation cannot crowd real plugins out', () => {
    const subject = reader({ allowed: [] })
    write([
      ...Array.from({ length: 1_000 }, (_unused, index) => ({ plugin: '@@@', signal: `s${index}`, active: 0 as const })),
      { signal: 'door', active: 1 },
    ])

    expect(rowsOf(subject.poll()).catalog).toEqual([{ plugin: 'homebridge-example', signal: 'door', summary: 'Door open' }])
  })

  it('rejects a row whose text has control characters', () => {
    const subject = reader()
    subject.create()
    write([{ signal: 'door', active: 1, summary: 'Line one\nLine two' }, { signal: 'window', active: 1 }])

    const result = rowsOf(subject.poll())

    expect(result.rows.map((row) => row.signal)).toEqual(['window'])
    expect(result.invalidRows).toBe(1)
    expect(result.catalog.map((entry) => entry.signal)).toEqual(['window'])
  })

  it('says the read was incomplete when it hit the cap', () => {
    const subject = reader()
    subject.create()
    write(Array.from({ length: 1_001 }, (_unused, index) => ({ signal: `s${index}`, active: 1 as const, at: index })))

    const result = rowsOf(subject.poll())

    expect(result.rows).toHaveLength(1_000)
    expect(result.complete).toBe(false)
  })

  it('counts rows that fail validation when a writer created a looser table', () => {
    const db = new sqlite.DatabaseSync(path)
    db.exec('CREATE TABLE signals (plugin TEXT, signal TEXT, active INTEGER, severity TEXT, summary TEXT, updated_at INTEGER, PRIMARY KEY (plugin, signal))')
    db.exec("INSERT INTO signals VALUES ('homebridge-example', 'ok', 1, 'info', 'fine', 1), ('homebridge-example', 'bad', 1, 'urgent', 'x', 1)")
    db.close()
    const subject = reader()
    subject.create()

    const result = rowsOf(subject.poll())

    expect(result.rows.map((row) => row.signal)).toEqual(['ok'])
    expect(result.invalidRows).toBe(1)
  })

  it('warns once about a store from a newer interface version, across reopens', () => {
    const log = fakeLogger()
    const stampNewer = (): void => {
      const db: DatabaseSync = new sqlite.DatabaseSync(path)
      db.exec('PRAGMA user_version = 9')
      db.close()
    }
    stampNewer()
    const subject = reader({ log })
    subject.create()
    unlinkSync(path)
    stampNewer()
    subject.poll()

    expect(log.lines('warn')).toEqual([
      'signal store is interface version 9; this plugin reads version 1. Update homebridge-pagerduty',
    ])
  })

  it('writes version 1 into a store it creates', () => {
    reader().create()
    const db = new sqlite.DatabaseSync(path)
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    db.close()

    expect(version).toBe(1)
  })

  it('tightens a store that other users can read', () => {
    if (process.platform === 'win32') {
      return
    }
    writeFileSync(path, '')
    chmodSync(path, 0o644)
    const log = fakeLogger()

    reader({ log }).create()

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(log.lines('info')).toContain(`tightened ${path} to owner-only`)
  })

  it('leaves modes alone on Windows', () => {
    writeFileSync(path, '')
    chmodSync(path, 0o644)

    reader({ platform: 'win32' }).create()

    expect(statSync(path).mode & 0o777).toBe(0o644)
  })

  it('reports a corrupt file as unavailable and keeps going', () => {
    writeFileSync(path, 'this is not a database, just text that is long enough to have a header')
    const subject = reader()

    const result = subject.poll()

    expect(result.kind).toBe('unavailable')
    expect(result.kind === 'unavailable' && result.reason).not.toBe('busy')
  })

  it('reports a busy store as busy and keeps the connection', () => {
    const busy = Object.assign(new Error('database is locked'), { errcode: 5 })
    let opens = 0
    const loadSqlite = (): SqliteModule => ({
      DatabaseSync: class {
        constructor() {
          opens += 1
        }
        exec(): void {
          throw busy
        }
        close(): void {}
      } as unknown as SqliteModule['DatabaseSync'],
    })
    writeFileSync(path, '')
    const subject = reader({ loadSqlite })

    expect(subject.poll()).toEqual({ kind: 'unavailable', reason: 'busy' })
    expect(opens).toBe(1)
  })

  it('reports a failure while creating the store to the caller', () => {
    writeFileSync(join(dir, 'homebridge-pagerduty'), 'in the way')
    const subject = reader({ path: join(dir, 'homebridge-pagerduty', 'signals.sqlite') })

    expect(() => subject.create()).toThrow()
  })

  it('logs, rather than throws, when closing fails', () => {
    const log = fakeLogger()
    const loadSqlite = (): SqliteModule => ({
      DatabaseSync: class {
        exec(): void {}
        prepare(): unknown {
          return { get: () => ({ user_version: 1, data_version: 1 }), all: () => [] }
        }
        close(): void {
          throw new Error('close failed')
        }
      } as unknown as SqliteModule['DatabaseSync'],
    })
    const subject = reader({ log, loadSqlite })
    subject.create()

    subject.close()
    subject.close()

    expect(log.lines('debug')).toEqual(['signal store close failed: close failed'])
  })
})
