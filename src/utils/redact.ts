/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Keeping the integration key out of logs, and untrusted text
 * safe to log.
 *
 * The routing key travels in every request body. Anyone holding it can open
 * incidents on the user's service and page the people on call, so it must
 * never reach a log line: not its value, its length or a prefix.
 *
 * As in the sibling plugins, these patterns match the *shape* of a key rather
 * than taking the key as an argument. Passing the secret to every logging site
 * is one refactor away from logging it.
 *
 * There are two tiers, because a routing key is a plain 32-character
 * alphanumeric run and so is a legitimate alert id.
 *
 * - {@link redactSecrets} removes a key that sits next to its field name. It
 *   is safe on every string, including the plugin's own log lines.
 * - {@link redactExternal} also removes any bare 32-character run. It is for
 *   text that came from outside the plugin: a response body or an error
 *   message. Applying it to the plugin's own lines would mangle alert ids.
 */

import { MAX_LOG_FIELD_LENGTH } from '../settings'

/** Replacement written in place of any matched secret. */
export const REDACTED = '[redacted]'

/** Field names that carry a routing key, in every spelling this plugin meets. */
const KEY_FIELDS = ['routing_key', 'routingKey', 'ROUTING_KEY', 'PAGERDUTY_ROUTING_KEY']

const KEYED_PATTERNS: readonly RegExp[] = [
  // `"routing_key":"..."`, with or without spaces around the colon.
  new RegExp(`("(?:${KEY_FIELDS.join('|')})"\\s*:\\s*)"[^"]*"`, 'g'),
  // `routing_key=...` in a query string or an environment dump.
  new RegExp(`((?:${KEY_FIELDS.join('|')})=)[^&\\s"')]+`, 'g'),
]

/** A bare integration key: exactly 32 letters and digits. */
const BARE_KEY = /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g

const ALL_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g

function replaceAll(value: string, patterns: readonly RegExp[]): string {
  let result = value
  for (const pattern of patterns) {
    // The capture group, where a pattern has one, is the field name and
    // separator, so the field stays readable and only its value goes.
    //
    // The type check is load-bearing: for a pattern with no capture group,
    // `replace` passes the match offset as the second argument.
    result = result.replace(pattern, (_match: string, prefix: unknown) => (
      typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED
    ))
  }
  return result
}

/**
 * Remove a routing key that appears next to its field name.
 *
 * A no-op on text with no key in it, so it can sit unconditionally on the
 * logging path.
 */
export function redactSecrets(value: string): string {
  return replaceAll(value, KEYED_PATTERNS)
}

/**
 * Remove anything key-shaped from text that came from outside the plugin.
 *
 * PagerDuty's `400` body can echo parts of the request, and a socket error
 * can quote anything. Neither is text the plugin wrote, so a bare 32-character
 * run there is treated as a key.
 */
export function redactExternal(value: string): string {
  return replaceAll(redactSecrets(value), [BARE_KEY])
}

/**
 * Make an untrusted string safe to interpolate into a log line.
 *
 * Alert names come from configuration and signal values come from other
 * plugins. A newline in a log line lets the writer forge entries, and a
 * terminal escape can rewrite what the user sees; truncation stops one long
 * value from burying everything else.
 */
export function forLog(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value)
  const sanitized = redactSecrets(text).replace(ALL_CONTROL_CHARACTERS, '\uFFFD')
  return sanitized.length > MAX_LOG_FIELD_LENGTH
    ? `${sanitized.slice(0, MAX_LOG_FIELD_LENGTH)}\u2026`
    : sanitized
}
