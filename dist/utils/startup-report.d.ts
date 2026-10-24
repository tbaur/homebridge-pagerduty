/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The configuration report logged once at startup.
 *
 * One line for the platform, then one line per alert and per optional
 * accessory, so the log shows what is running without opening config.json.
 * The routing key never appears.
 */
import type { ResolvedAccessory, ResolvedConfig } from '../types';
/** What changed while the accessories were synced with the cache. */
export interface AccessoryChanges {
    /** Created on this start rather than restored from the cache. */
    created: ReadonlySet<ResolvedAccessory>;
    /** Restored under a different name. The value is the old name. */
    renamed: ReadonlyMap<ResolvedAccessory, string>;
}
/** What the startup report is built from. */
export interface StartupReportInput {
    config: ResolvedConfig;
    accessories: readonly ResolvedAccessory[];
    pluginVersion: string;
    changes: AccessoryChanges;
    /** Signal names by plugin from the first store read. Undefined leaves the signal lines out. */
    signalsWritten?: ReadonlyMap<string, readonly string[]>;
}
/** Build the startup report, one log line per entry. */
export declare function formatStartupReport(input: StartupReportInput): string[];
