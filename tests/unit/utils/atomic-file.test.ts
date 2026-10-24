/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * A torn state file reads back as corrupt and triggers a resolve sweep. These
 * tests pin the replace path, including the Windows fallback that cannot be
 * exercised on the CI hosts directly.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeJsonAtomic, type AtomicFileDeps } from '../../../src/utils/atomic-file'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-atomic-'))
  path = join(dir, 'state.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function deps(rename: AtomicFileDeps['rename'], platform: typeof process.platform = 'win32'): AtomicFileDeps {
  let tick = 0
  return { rename, platform, now: () => (tick += 1) }
}

describe('writeJsonAtomic', () => {
  it('writes pretty JSON with the requested mode and leaves no temp file', async () => {
    await writeJsonAtomic(path, { a: 1 }, 0o600)

    expect(readFileSync(path, 'utf8')).toBe('{\n  "a": 1\n}\n')
    expect(readdirSync(dir)).toEqual(['state.json'])
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces an existing file', async () => {
    writeFileSync(path, 'old')

    await writeJsonAtomic(path, { b: 2 }, 0o600)

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ b: 2 })
  })

  it('moves the live file aside when a rename cannot overwrite (Windows)', async () => {
    writeFileSync(path, 'old')
    let first = true
    const rename: AtomicFileDeps['rename'] = (from, to) => {
      if (first) {
        first = false
        return Promise.reject(errno('EPERM'))
      }
      return fs.rename(from, to)
    }

    await writeJsonAtomic(path, { c: 3 }, 0o600, deps(rename))

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ c: 3 })
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('restores the backup when promotion fails, and still throws', async () => {
    writeFileSync(path, 'old')
    let call = 0
    const rename: AtomicFileDeps['rename'] = (from, to) => {
      call += 1
      if (call === 1 || call === 3) {
        return Promise.reject(errno('EACCES'))
      }
      return fs.rename(from, to)
    }

    await expect(writeJsonAtomic(path, { d: 4 }, 0o600, deps(rename))).rejects.toThrow('EACCES')

    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('names both failures when the backup cannot be restored either', async () => {
    writeFileSync(path, 'old')
    let call = 0
    const rename: AtomicFileDeps['rename'] = (from, to) => {
      call += 1
      if (call === 2) {
        return fs.rename(from, to)
      }
      return Promise.reject(errno(call === 1 ? 'EEXIST' : 'EBUSY'))
    }

    await expect(writeJsonAtomic(path, { e: 5 }, 0o600, deps(rename)))
      .rejects.toThrow(/failed to replace .* and to restore its backup: .*EBUSY.*restore: .*EBUSY/)
  })

  it('rethrows a rename failure that the fallback cannot help with', async () => {
    const rename: AtomicFileDeps['rename'] = () => Promise.reject(errno('ENOSPC'))

    await expect(writeJsonAtomic(path, {}, 0o600, deps(rename, 'linux'))).rejects.toThrow('ENOSPC')
    expect(readdirSync(dir)).toEqual([])
  })
})
