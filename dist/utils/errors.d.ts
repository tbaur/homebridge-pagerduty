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
/**
 * The Node system error code (`ENOENT`, `EPERM`), if the error carries one.
 *
 * Duck-typed: an error raised by Node internals can come from another realm,
 * where `instanceof Error` is false.
 */
export declare function errorCode(error: unknown): string | undefined;
/**
 * Describe an error, including any `cause` chain, for a single log line.
 *
 * Control characters are replaced: an error message can contain remote input,
 * and a newline inside a log line lets an attacker forge log entries.
 */
export declare function describeError(error: unknown): string;
/** Raised when PagerDuty answered, but not with something usable. */
export declare class ProtocolError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Raised when PagerDuty could not be reached at all. */
export declare class ConnectionError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Raised when the state file exists but cannot be read.
 *
 * Distinct from a corrupt file on purpose. A corrupt file is renamed aside and
 * replaced; an unreadable one (`EACCES`, `EIO`) disables the platform, because
 * starting empty would hide whatever is wrong with the disk.
 */
export declare class StateUnreadableError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
