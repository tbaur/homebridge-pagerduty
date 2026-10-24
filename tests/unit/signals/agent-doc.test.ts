/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * docs/SIGNALS-AGENT.md is handed to coding agents, who copy its module into
 * other plugins unchanged. These tests compile that module and run it against
 * this plugin's reader, so the published code cannot drift from the store.
 *
 * Copies already in other plugins cannot be updated from here, so the module
 * published for each interface identifier is frozen in tests/fixtures. Each
 * frozen copy must keep writing rows this version reads, for as long as this
 * version reads its identifier.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as ts from 'typescript'

import { DATA_DIR_NAME, SIGNAL_INTERFACE_ID, SIGNAL_STORE_FILE_NAME } from '../../../src/settings'
import { SignalReader } from '../../../src/signals/reader'
import { SIGNAL_SCHEMA_SQL } from '../../../src/signals/schema'
import { fakeLogger } from '../../helpers/hap'

interface AgentModule {
  PagerDutySignals: new (options: { plugin: string; storagePath: string; log: { warn(message: string): void } }) => {
    write(signal: string, state: { active: boolean; severity: string; summary: string }): void
    close(): void
  }
}

const DOC = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'SIGNALS-AGENT.md'), 'utf8')
const FROZEN_MODULES_DIR = join(__dirname, '..', '..', 'fixtures', 'signal-modules')
const FROZEN_MODULE_SUFFIX = '.ts.txt'
const FROZEN_IDENTIFIERS = readdirSync(FROZEN_MODULES_DIR).map((name) => name.slice(0, -FROZEN_MODULE_SUFFIX.length))
const MODULE_SOURCE = /## Module to copy\n\n```ts\n([\s\S]*?)```/.exec(DOC)?.[1] ?? ''

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-agent-doc-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function compileModule(source: string): AgentModule {
  const sourcePath = join(dir, 'pagerduty-signals.ts')
  writeFileSync(sourcePath, source)
  const program = ts.createProgram([sourcePath], {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    types: ['node'],
    typeRoots: [join(__dirname, '..', '..', '..', 'node_modules', '@types')],
    outDir: dir,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  expect(diagnostics).toEqual([])
  program.emit()
  return require(join(dir, 'pagerduty-signals.js')) as AgentModule
}

function frozenModule(identifier: string): string {
  return readFileSync(join(FROZEN_MODULES_DIR, `${identifier}${FROZEN_MODULE_SUFFIX}`), 'utf8')
}

describe('docs/SIGNALS-AGENT.md', () => {
  it('publishes the schema text verbatim, in the table definition and in the module', () => {
    expect(/```sql\n([\s\S]*?)\n```/.exec(DOC)?.[1]).toBe(SIGNAL_SCHEMA_SQL)
    expect(/const SCHEMA = `([\s\S]*?)`/.exec(MODULE_SOURCE)?.[1]).toBe(SIGNAL_SCHEMA_SQL)
  })

  it('publishes the module frozen for the current interface identifier, unchanged', () => {
    expect(MODULE_SOURCE).toContain(`const INTERFACE_ID = '${SIGNAL_INTERFACE_ID}'`)
    expect(MODULE_SOURCE).toBe(frozenModule(SIGNAL_INTERFACE_ID))
  })

  it('keeps a frozen module for each interface identifier this version reads, and no other', () => {
    expect(FROZEN_IDENTIFIERS).toEqual([SIGNAL_INTERFACE_ID])
  })
})

describe.each(FROZEN_IDENTIFIERS)('the module frozen for %s', (identifier) => {
  it('compiles under strict settings and writes rows this plugin reads, even from text with a newline', () => {
    const { PagerDutySignals } = compileModule(frozenModule(identifier))
    const warnings: string[] = []
    const storagePath = join(dir, 'storage')
    const signals = new PagerDutySignals({ plugin: 'homebridge-example', storagePath, log: { warn: (message) => warnings.push(message) } })

    signals.write('sump-high', { active: true, severity: 'error', summary: 'Sump water level is high' })
    signals.write('hub-offline', { active: false, severity: 'warning', summary: 'Hub is\noffline' })
    signals.close()

    const path = join(storagePath, DATA_DIR_NAME, identifier, SIGNAL_STORE_FILE_NAME)
    expect(statSync(join(storagePath, DATA_DIR_NAME)).mode & 0o777).toBe(0o700)
    expect(statSync(join(storagePath, DATA_DIR_NAME, identifier)).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(warnings).toEqual([])

    const reader = new SignalReader({ path, allowed: ['homebridge-example'], log: fakeLogger() })
    reader.create()
    const result = reader.poll()
    reader.close()

    expect(result).toEqual(expect.objectContaining({ kind: 'rows', invalidRows: 0 }))
    const rows = result.kind === 'rows' ? result.rows : []
    expect(rows.map((row) => [row.plugin, row.signal, row.active, row.severity, row.summary]).sort()).toEqual([
      ['homebridge-example', 'hub-offline', false, 'warning', 'Hub is offline'],
      ['homebridge-example', 'sump-high', true, 'error', 'Sump water level is high'],
    ])
  })
})
