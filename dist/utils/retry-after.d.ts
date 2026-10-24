/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview `Retry-After` parsing.
 *
 * PagerDuty does not document whether a `429` carries `Retry-After`. It is
 * honoured when present and never depended on.
 */
/**
 * Parse an HTTP `Retry-After` header into milliseconds.
 *
 * Supports the delta-seconds and HTTP-date forms, clamps to `capMs`, and
 * returns `undefined` when the header is absent or unparseable, so the caller
 * falls back to its own backoff. The cap is a parameter because each plugin
 * that copies this has a different ceiling.
 */
export declare function parseRetryAfterMs(header: string | string[] | undefined, capMs: number, now?: () => number): number | undefined;
