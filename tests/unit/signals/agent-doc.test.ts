/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * docs/SIGNALS-AGENT.md is handed to coding agents, who copy its module into
 * other plugins unchanged. These tests compile that module and run it against
 * this plugin's reader, so the published code cannot drift from the store.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as ts from 'typescript'

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
const MODULE_SOURCE = /## Module to copy\n\n```ts\n([\s\S]*?)```/.exec(DOC)?.[1] ?? ''

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-agent-doc-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function compileModule(): AgentModule {
  const sourcePath = join(dir, 'pagerduty-signals.ts')
  writeFileSync(sourcePath, MODULE_SOURCE)
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

describe('docs/SIGNALS-AGENT.md', () => {
  it('publishes the schema text verbatim, in the table definition and in the module', () => {
    expect(/```sql\n([\s\S]*?)\n```/.exec(DOC)?.[1]).toBe(SIGNAL_SCHEMA_SQL)
    expect(/const SCHEMA = `([\s\S]*?)`/.exec(MODULE_SOURCE)?.[1]).toBe(SIGNAL_SCHEMA_SQL)
  })

  it('has a module that compiles under strict settings and writes rows this plugin reads, even from text with a newline', () => {
    const { PagerDutySignals } = compileModule()
    const warnings: string[] = []
    const storagePath = join(dir, 'storage')
    const signals = new PagerDutySignals({ plugin: 'homebridge-example', storagePath, log: { warn: (message) => warnings.push(message) } })

    signals.write('sump-high', { active: true, severity: 'error', summary: 'Sump water level is high' })
    signals.write('hub-offline', { active: false, severity: 'warning', summary: 'Hub is\noffline' })
    signals.close()

    const path = join(storagePath, 'homebridge-pagerduty', 'signals.sqlite')
    expect(statSync(join(storagePath, 'homebridge-pagerduty')).mode & 0o777).toBe(0o700)
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
