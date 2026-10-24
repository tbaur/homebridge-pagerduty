/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * A routing key written as one literal next to its field name is the shape
 * the CI secrets job greps for. This is the same pattern over the same
 * paths, so `npm test` fails before a push does.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')

const SKIP_DIRS = new Set(['node_modules', 'coverage', '.git'])

/** Keep in step with the `secrets` job in .github/workflows/test.yml. */
const ROUTING_KEY_LITERAL = /(routing_key|routingKey|ROUTING_KEY)["']?\s*[:=]\s*["']?[A-Za-z0-9]{32}/

const ROOTS = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'DEVELOPMENT.md',
  'RELEASING.md',
  'CHANGELOG.md',
  'config.schema.json',
  'docs',
  'src',
  'tests',
  'scripts',
  'dist',
  '.github',
]

function walk(path: string, files: string[]): void {
  if (!existsSync(path)) {
    return
  }
  if (statSync(path).isDirectory()) {
    if (SKIP_DIRS.has(path.split(/[/\\]/).pop() ?? '')) {
      return
    }
    for (const name of readdirSync(path)) {
      walk(join(path, name), files)
    }
    return
  }
  files.push(path)
}

describe('committed text', () => {
  const files: string[] = []
  for (const entry of ROOTS) {
    walk(join(ROOT, entry), files)
  }

  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('contains no routing key as a contiguous literal', () => {
    const hits = files.filter((file) => ROUTING_KEY_LITERAL.test(readFileSync(file, 'utf8')))

    expect(hits.map((file) => relative(ROOT, file))).toEqual([])
  })

  it('agrees with the CI job, so the two cannot drift apart', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8')

    // The workflow splices shell quotes into the middle, so match the parts.
    for (const part of ['(routing_key|routingKey|ROUTING_KEY)', '[[:space:]]*[:=][[:space:]]*', '[A-Za-z0-9]{32}']) {
      expect(workflow).toContain(part)
    }
  })
})
