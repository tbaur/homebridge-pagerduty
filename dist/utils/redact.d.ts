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
/** Replacement written in place of any matched secret. */
export declare const REDACTED = "[redacted]";
/**
 * Remove a routing key that appears next to its field name.
 *
 * A no-op on text with no key in it, so it can sit unconditionally on the
 * logging path.
 */
export declare function redactSecrets(value: string): string;
/**
 * Remove anything key-shaped from text that came from outside the plugin.
 *
 * PagerDuty's `400` body can echo parts of the request, and a socket error
 * can quote anything. Neither is text the plugin wrote, so a bare 32-character
 * run there is treated as a key.
 */
export declare function redactExternal(value: string): string;
/**
 * Make an untrusted string safe to interpolate into a log line.
 *
 * Alert names come from configuration and signal values come from other
 * plugins. A newline in a log line lets the writer forge entries, and a
 * terminal escape can rewrite what the user sees; truncation stops one long
 * value from burying everything else.
 */
export declare function forLog(value: unknown): string;
