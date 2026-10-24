/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Shared plumbing for the maintenance scripts in this directory.
 *
 * `smoke.js` sends real events, so nothing here has a built-in key: it comes
 * from the environment or from a prompt that does not echo.
 *
 * **A routing key must never be a command-line argument.** It would sit in the
 * shell history, and on most systems it is readable by any other process on
 * the machine for as long as the script runs. Anyone holding it can page the
 * people on call for that service.
 */
const readline = require('node:readline')
const path = require('node:path')

/** The shape the plugin validates. */
const ROUTING_KEY_PATTERN = /^[A-Za-z0-9]{32}$/

/** Print a message and exit non-zero. Scripts are tools, not libraries. */
function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

/**
 * Parse `--key value` and `--flag` arguments into an object.
 *
 * Unknown keys are rejected rather than ignored, so a typo cannot silently
 * leave the default in place. Neither a stray token nor an unknown flag is
 * echoed: either may be a key pasted where it does not belong.
 */
function parseFlags(argv, known) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      fail('unexpected argument (not a --flag). A routing key must not be a command-line argument')
    }
    const key = token.slice(2)
    if (!Object.prototype.hasOwnProperty.call(known, key)) {
      fail(`unknown option. Known options: ${Object.keys(known).map((name) => `--${name}`).join(', ')}`)
    }
    if (known[key] === 'boolean') {
      flags[key] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      fail(`--${key} needs a value`)
    }
    flags[key] = value
    index += 1
  }
  return flags
}

/**
 * Load one compiled module of the plugin.
 *
 * The scripts use the code the plugin runs rather than reimplementing it,
 * which is the only way a script's result says anything about the plugin.
 */
function requireBuild(modulePath) {
  const target = path.join(__dirname, '..', '..', 'dist', `${modulePath}.js`)
  try {
    return require(target)
  } catch (error) {
    fail(`could not load ${target}: ${error.message}\nRun "npm run build" first.`)
  }
}

/** Ask a question on the terminal and return the answer. */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Turn one stdin chunk into characters.
 *
 * After `readline` has asked a question, stdin is often left in utf8 mode, so
 * `data` events carry strings. In raw mode they may still be Buffers. Both
 * must produce the same characters.
 */
function decodeHiddenChunk(chunk) {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
}

/** Fold one chunk into the hidden value so far. Returns `{ value, done, cancelled }`. */
function consumeHiddenChunk(value, chunk) {
  let next = value
  for (const character of decodeHiddenChunk(chunk)) {
    if (character === '\u0003') {
      return { value: next, done: true, cancelled: true }
    }
    if (character === '\r' || character === '\n') {
      return { value: next, done: true, cancelled: false }
    }
    if (character === '\u007f' || character === '\b') {
      next = next.slice(0, -1)
      continue
    }
    if (character < ' ') {
      continue
    }
    next += character
  }
  return { value: next, done: false, cancelled: false }
}

/**
 * Ask for a secret without echoing it.
 *
 * Raw mode, restored on every path including Ctrl-C, which would otherwise
 * leave the user's shell with echo switched off.
 */
function askHidden(question) {
  const { stdin, stdout } = process
  if (stdin.isTTY !== true) {
    return ask(question)
  }
  return new Promise((resolve, reject) => {
    stdout.write(question)
    let value = ''
    const wasRaw = stdin.isRaw === true

    const restore = () => {
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
    }
    const onData = (chunk) => {
      const outcome = consumeHiddenChunk(value, chunk)
      value = outcome.value
      if (!outcome.done) {
        return
      }
      restore()
      if (outcome.cancelled) {
        reject(new Error('cancelled'))
        return
      }
      resolve(value)
    }

    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

/**
 * Check a routing key's shape without saying anything about its value.
 *
 * Not its length, not a prefix: the plugin's rule, kept here too.
 */
function checkRoutingKey(value) {
  const trimmed = String(value).trim()
  if (!ROUTING_KEY_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'that is not a 32-character PagerDuty integration key' }
  }
  return { ok: true, key: trimmed }
}

/**
 * Resolve the routing key: `PAGERDUTY_ROUTING_KEY`, or a prompt that does not
 * echo. Never a command-line flag; see the file header.
 */
async function resolveRoutingKey() {
  const raw = process.env.PAGERDUTY_ROUTING_KEY || await askHidden('PagerDuty integration key (hidden): ')
  const checked = checkRoutingKey(raw)
  if (!checked.ok) {
    fail(checked.reason)
  }
  return checked.key
}

/** Run a script's main function, reporting a failure without a stack wall. */
function run(main) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = {
  ask,
  askHidden,
  checkRoutingKey,
  consumeHiddenChunk,
  fail,
  parseFlags,
  requireBuild,
  resolveRoutingKey,
  run,
}
