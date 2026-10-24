/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Crash-safe file replacement.
 *
 * The state file records what PagerDuty has accepted. A torn write there is
 * worse than a lost one: it reads back as corrupt, and the plugin then has to
 * resolve every alert it cannot account for. So a write goes to a temporary
 * file, is flushed, and replaces the live file in one rename. On POSIX systems
 * the directory is flushed too, so the rename itself survives a power cut.
 */
/** Injection points for tests. Production uses `node:fs` directly. */
export interface AtomicFileDeps {
    rename: (from: string, to: string) => Promise<void>;
    platform: typeof process.platform;
    now: () => number;
}
/**
 * Write `value` as JSON to `path` atomically, with the given file mode.
 *
 * Throws on failure. The temporary file is always removed.
 */
export declare function writeJsonAtomic(path: string, value: unknown, mode: number, deps?: AtomicFileDeps): Promise<void>;
