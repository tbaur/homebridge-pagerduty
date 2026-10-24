/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * A guard, not a unit test.
 *
 * This plugin has no captured fixtures, so the guard covers every committed
 * text file instead. Addresses, emails and home paths copied from a real
 * setup are a disclosure once pushed, and test data is where they creep in.
 * Only documentation ranges and placeholder values are allowed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SKIP_DIRS = new Set(['node_modules', 'coverage', '.git', 'dist'])
const TEXT = /\.(?:ts|js|json|md|yml|yaml)$/
const ROOTS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'DEVELOPMENT.md', 'RELEASING.md', 'CHANGELOG.md', 'config.schema.json', 'docs', 'src', 'tests', 'scripts', '.github']

const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g
const ALLOWED_IPV4 = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./, /^127\.0\.0\.1$/, /^0\.0\.0\.0$/]
const MAC = /\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g
const ALLOWED_MAC = /^02:00:00:00:00:[0-9a-f]{2}$/i
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi
const ALLOWED_EMAIL = /@(?:example\.(?:com|net|org)|users\.noreply\.github\.com)$/i
const HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+/g
const ALLOWED_HOME = /^\/(?:Users\/example|home\/user)$/

function walk(path: string, files: string[]): void {
  if (!existsSync(path)) {
    return
  }
  if (statSync(path).isDirectory()) {
    if (!SKIP_DIRS.has(path.split(/[/\\]/).pop() ?? '')) {
      for (const name of readdirSync(path)) {
        walk(join(path, name), files)
      }
    }
    return
  }
  if (TEXT.test(path) || !path.includes('.')) {
    files.push(path)
  }
}

function offenders(pattern: RegExp, allowed: (value: string) => boolean): string[] {
  const found: string[] = []
  for (const file of FILES) {
    for (const match of readFileSync(file, 'utf8').match(pattern) ?? []) {
      if (!allowed(match)) {
        found.push(`${relative(ROOT, file)}: ${match}`)
      }
    }
  }
  return found
}

const FILES: string[] = []
for (const entry of ROOTS) {
  walk(join(ROOT, entry), FILES)
}

describe('committed text', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('uses only documentation IPv4 ranges', () => {
    expect(offenders(IPV4, (value) => ALLOWED_IPV4.some((range) => range.test(value)))).toEqual([])
  })

  it('uses only placeholder MAC addresses', () => {
    expect(offenders(MAC, (value) => ALLOWED_MAC.test(value))).toEqual([])
  })

  it('uses only example email domains', () => {
    expect(offenders(EMAIL, (value) => ALLOWED_EMAIL.test(value))).toEqual([])
  })

  it('names no real home directory', () => {
    expect(offenders(HOME_PATH, (value) => ALLOWED_HOME.test(value))).toEqual([])
  })
})
