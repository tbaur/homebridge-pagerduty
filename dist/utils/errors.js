"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Error types and description helpers.
 *
 * Node wraps low-level network failures in `cause` chains, so a bare
 * `error.message` frequently reads "request failed" while the useful detail
 * (ENOTFOUND, ETIMEDOUT) sits one level down.
 *
 * Every description produced here goes through {@link redactExternal}: an
 * error message is text the plugin did not write, and it is the one route by
 * which a request body (and the routing key in it) could reach a log line.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateUnreadableError = exports.ConnectionError = exports.ProtocolError = void 0;
exports.errorCode = errorCode;
exports.describeError = describeError;
const redact_1 = require("./redact");
/** Longest description produced, so a hostile endpoint cannot flood the log. */
const MAX_DESCRIPTION_LENGTH = 300;
/**
 * The Node system error code (`ENOENT`, `EPERM`), if the error carries one.
 *
 * Duck-typed: an error raised by Node internals can come from another realm,
 * where `instanceof Error` is false.
 */
function errorCode(error) {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const code = error.code;
    return typeof code === 'string' && code.length > 0 ? code : undefined;
}
function messageOf(error) {
    if (error instanceof Error) {
        const code = errorCode(error);
        return code !== undefined
            ? `${error.message} (${code})`
            : error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        return JSON.stringify(error) ?? String(error);
    }
    catch {
        return String(error);
    }
}
/**
 * Describe an error, including any `cause` chain, for a single log line.
 *
 * Control characters are replaced: an error message can contain remote input,
 * and a newline inside a log line lets an attacker forge log entries.
 */
function describeError(error) {
    const parts = [];
    let current = error;
    const seen = new Set();
    while (current !== undefined && current !== null && !seen.has(current)) {
        seen.add(current);
        const text = messageOf(current);
        if (text.length > 0 && !parts.includes(text)) {
            parts.push(text);
        }
        current = current instanceof Error ? current.cause : undefined;
    }
    const joined = parts.length > 0 ? parts.join(': ') : 'unknown error';
    const sanitized = (0, redact_1.redactExternal)(joined).replace(/[\u0000-\u001F\u007F]/g, '\uFFFD');
    return sanitized.length > MAX_DESCRIPTION_LENGTH
        ? `${sanitized.slice(0, MAX_DESCRIPTION_LENGTH)}\u2026`
        : sanitized;
}
/** Raised when PagerDuty answered, but not with something usable. */
class ProtocolError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ProtocolError';
    }
}
exports.ProtocolError = ProtocolError;
/** Raised when PagerDuty could not be reached at all. */
class ConnectionError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ConnectionError';
    }
}
exports.ConnectionError = ConnectionError;
/**
 * Raised when the state file exists but cannot be read.
 *
 * Distinct from a corrupt file on purpose. A corrupt file is renamed aside and
 * replaced; an unreadable one (`EACCES`, `EIO`) disables the platform, because
 * starting empty would hide whatever is wrong with the disk.
 */
class StateUnreadableError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'StateUnreadableError';
    }
}
exports.StateUnreadableError = StateUnreadableError;
