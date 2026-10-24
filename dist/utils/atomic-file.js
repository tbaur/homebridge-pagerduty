"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonAtomic = writeJsonAtomic;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const errors_1 = require("./errors");
const defaultDeps = {
    rename: (from, to) => node_fs_1.promises.rename(from, to),
    platform: process.platform,
    now: Date.now,
};
/**
 * Write `value` as JSON to `path` atomically, with the given file mode.
 *
 * Throws on failure. The temporary file is always removed.
 */
async function writeJsonAtomic(path, value, mode, deps = defaultDeps) {
    const tempPath = `${path}.${process.pid}.${deps.now()}.tmp`;
    try {
        await writeFileDurable(tempPath, `${JSON.stringify(value, null, 2)}\n`, mode);
        await replaceFile(tempPath, path, deps);
        if (deps.platform !== 'win32') {
            await syncDirectory((0, node_path_1.dirname)(path));
        }
    }
    finally {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
    }
}
/** Write and fsync, so a following rename cannot publish a truncated file. */
async function writeFileDurable(path, contents, mode) {
    const handle = await node_fs_1.promises.open(path, 'w', mode);
    try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
/**
 * Flush a directory entry.
 *
 * Without this, a rename can still be lost on power failure even though both
 * files were synced. Some filesystems refuse to open a directory for sync;
 * that is not worth failing a state write over.
 */
async function syncDirectory(path) {
    let handle;
    try {
        handle = await node_fs_1.promises.open(path, 'r');
        await handle.sync();
    }
    catch {
        // Best effort; see above.
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
/**
 * Replace `destPath` with `tempPath`. Prefer a direct rename. When the
 * platform refuses to overwrite (typical on Windows), move the live file
 * aside, promote the temp file, and restore the backup if promotion fails.
 */
async function replaceFile(tempPath, destPath, deps) {
    try {
        await deps.rename(tempPath, destPath);
        return;
    }
    catch (renameError) {
        const code = (0, errors_1.errorCode)(renameError);
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
            throw renameError;
        }
    }
    await replaceFileWindows(tempPath, destPath, deps);
}
async function replaceFileWindows(tempPath, destPath, deps) {
    const backupPath = `${destPath}.${process.pid}.${deps.now()}.bak`;
    await deps.rename(destPath, backupPath);
    try {
        await deps.rename(tempPath, destPath);
    }
    catch (promoteError) {
        await restoreBackup({ backupPath, livePath: destPath, promoteError, deps });
        throw promoteError;
    }
    await node_fs_1.promises.rm(backupPath, { force: true });
}
async function restoreBackup(input) {
    try {
        await input.deps.rename(input.backupPath, input.livePath);
    }
    catch (restoreError) {
        throw new Error(`failed to replace ${input.livePath} and to restore its backup: `
            + `${(0, errors_1.describeError)(input.promoteError)}; restore: ${(0, errors_1.describeError)(restoreError)}`);
    }
}
