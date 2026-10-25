/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The maintenance scripts take a real integration key. The one thing they
 * must not do is print it, including when someone pastes it as a positional
 * argument or as `--routing-key <key>`.
 *
 * The reference writer is what other plugin authors copy, so it is checked
 * against the plugin's own reader rather than against itself.
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { SIGNAL_SCHEMA_SQL } from '../../src/signals/schema'
import { SignalReader } from '../../src/signals/reader'
import { DATA_DIR_NAME, SIGNAL_INTERFACE_ID, SIGNAL_STORE_FILE_NAME } from '../../src/settings'
import { fakeLogger } from '../helpers/hap'
import { FAKE_ROUTING_KEY } from '../helpers/secrets'

const SCRIPTS = join(__dirname, '..', '..', 'scripts')

interface CommonLib {
  parseFlags(argv: string[], known: Record<string, string>): Record<string, unknown>
  consumeHiddenChunk(value: string, chunk: string | Buffer): { value: string; done: boolean; cancelled: boolean }
  checkRoutingKey(value: string): { ok: true; key: string } | { ok: false; reason: string }
}

interface ReferenceWriter {
  SCHEMA: string
  STORE_DIR: string
  INTERFACE_ID: string
  STORE_FILE: string
  openStore(storageDir: string): DatabaseSync
  writeSignal(db: DatabaseSync, signal: {
    plugin: string
    signal: string
    active: boolean
    severity: string
    summary: string
    updatedAt?: number
  }): void
}

function common(): CommonLib {
  return require(join(SCRIPTS, 'lib', 'common.js')) as CommonLib
}

function writer(): ReferenceWriter {
  return require(join(SCRIPTS, 'reference-writer.js')) as ReferenceWriter
}

describe('script flag parsing', () => {
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    jest.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message))
    })
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code ?? 0}`)
    }) as never)
  })

  it('does not echo a positional key', () => {
    expect(() => common().parseFlags([FAKE_ROUTING_KEY], { yes: 'boolean' })).toThrow(/exit 1/)

    const printed = errors.join('\n')
    expect(printed).not.toContain(FAKE_ROUTING_KEY)
    expect(printed).toMatch(/unexpected argument/)
  })

  it('does not echo an unknown --routing-key flag or its value', () => {
    expect(() => common().parseFlags(['--routing-key', FAKE_ROUTING_KEY], { yes: 'boolean' })).toThrow(/exit 1/)

    const printed = errors.join('\n')
    expect(printed).not.toContain(FAKE_ROUTING_KEY)
    expect(printed).not.toContain('--routing-key')
  })

  it('reads known flags, and asks for a missing value', () => {
    expect(common().parseFlags(['--region', 'eu', '--yes'], { region: 'string', yes: 'boolean' }))
      .toEqual({ region: 'eu', yes: true })
    expect(() => common().parseFlags(['--region'], { region: 'string' })).toThrow(/exit 1/)
    expect(errors.join('\n')).toContain('--region needs a value')
  })
})

describe('the hidden key prompt', () => {
  it('keeps characters that arrive as utf8 strings, the way readline leaves stdin', () => {
    const { consumeHiddenChunk } = common()
    const typed = consumeHiddenChunk('', 'abc')
    expect(typed).toEqual({ value: 'abc', done: false, cancelled: false })
    expect(consumeHiddenChunk(typed.value, '\r')).toEqual({ value: 'abc', done: true, cancelled: false })
  })

  it('reads a Buffer the same way, handles backspace, and treats Ctrl-C as cancel', () => {
    const { consumeHiddenChunk } = common()
    expect(consumeHiddenChunk('', Buffer.from('abx\u007fc\n'))).toEqual({ value: 'abc', done: true, cancelled: false })
    expect(consumeHiddenChunk('ab', '\u0003')).toEqual({ value: 'ab', done: true, cancelled: true })
  })
})

describe('checkRoutingKey', () => {
  it('accepts the plugin\'s shape, trimmed', () => {
    expect(common().checkRoutingKey(` ${FAKE_ROUTING_KEY}\n`)).toEqual({ ok: true, key: FAKE_ROUTING_KEY })
  })

  it('rejects anything else without repeating it', () => {
    const wrong = `${FAKE_ROUTING_KEY.slice(0, 31)}!`
    const result = common().checkRoutingKey(wrong)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(wrong)
  })
})

describe('reference writer', () => {
  let dir: string
  let reader: SignalReader | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-writer-'))
  })

  afterEach(() => {
    reader?.close()
    reader = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  it('carries the published schema verbatim and the plugin\'s path', () => {
    expect(writer().SCHEMA).toBe(SIGNAL_SCHEMA_SQL)
    expect(writer().STORE_DIR).toBe(DATA_DIR_NAME)
    expect(writer().INTERFACE_ID).toBe(SIGNAL_INTERFACE_ID)
    expect(writer().STORE_FILE).toBe(SIGNAL_STORE_FILE_NAME)
  })

  it('writes rows the plugin reads, into an owner-only directory and file', () => {
    const db = writer().openStore(dir)
    try {
      writer().writeSignal(db, { plugin: 'homebridge-example', signal: 'sump-high', active: true, severity: 'critical', summary: 'Sump high', updatedAt: 5 })
      writer().writeSignal(db, { plugin: 'homebridge-example', signal: 'door', active: false, severity: 'info', summary: 'Door closed' })
    } finally {
      db.close()
    }

    const storeFile = join(dir, DATA_DIR_NAME, SIGNAL_INTERFACE_ID, SIGNAL_STORE_FILE_NAME)
    reader = new SignalReader({ path: storeFile, allowed: ['homebridge-example'], log: fakeLogger() })
    const result = reader.poll()

    expect(result.kind).toBe('rows')
    expect(result.kind === 'rows' ? result.rows.map((row) => `${row.signal}:${row.active}:${row.severity}`).sort() : [])
      .toEqual(['door:false:info', 'sump-high:true:critical'])
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, DATA_DIR_NAME)).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, DATA_DIR_NAME, SIGNAL_INTERFACE_ID)).mode & 0o777).toBe(0o700)
      expect(statSync(storeFile).mode & 0o777).toBe(0o600)
    }
  })

  it('lets SQLite reject a malformed row inside the writer', () => {
    const db = writer().openStore(dir)
    try {
      expect(() => writer().writeSignal(db, { plugin: 'Bad Name', signal: 'door', active: true, severity: 'warning', summary: 'x' }))
        .toThrow(/CHECK constraint/)
    } finally {
      db.close()
    }
  })
})
