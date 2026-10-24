"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRetryAfterMs = parseRetryAfterMs;
const NUMERIC = /^[+-]?\d+(?:\.\d+)?$/;
/**
 * Parse an HTTP `Retry-After` header into milliseconds.
 *
 * Supports the delta-seconds and HTTP-date forms, clamps to `capMs`, and
 * returns `undefined` when the header is absent or unparseable, so the caller
 * falls back to its own backoff. The cap is a parameter because each plugin
 * that copies this has a different ceiling.
 */
function parseRetryAfterMs(header, capMs, now = Date.now) {
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    // A number is never handed to `Date.parse`, which reads `-5` as a year.
    if (NUMERIC.test(trimmed)) {
        const seconds = Number(trimmed);
        return seconds >= 0 ? Math.min(seconds * 1_000, capMs) : undefined;
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        return Math.min(Math.max(dateMs - now(), 0), capMs);
    }
    return undefined;
}
