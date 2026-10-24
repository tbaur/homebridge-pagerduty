/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation.
 *
 * Three outcomes, each chosen for what it costs the user when they are wrong.
 *
 * - **Not configured.** No routing key. One log line, nothing started, cached
 *   accessories kept, as verified review requires.
 * - **Invalid.** The file does not describe anything usable. The platform
 *   disables itself and keeps cached accessories, so a typo does not cost
 *   anyone their automations.
 * - **One bad alert.** An entry with a readable `id` but a bad field is
 *   *held*: its state and accessories stay exactly as they were and nothing is
 *   sent for it. Treating it as removed would resolve a live incident.
 *
 * Nothing here ever puts the routing key into a message: not its length, not
 * a prefix, not "you typed ... ". Validation says whether it is usable.
 */
import type { ResolvedAccessory, ResolvedConfig, Severity } from '../types';
/** Outcome of validating a platform configuration block. */
export interface ConfigValidationResult {
    status: 'ok' | 'notConfigured' | 'invalid';
    /** Fatal problems. Non-empty exactly when `status` is `invalid`. */
    errors: string[];
    /** Problems worth reporting that do not prevent operation. */
    warnings: string[];
    /** Present exactly when `status` is `ok`. */
    config?: ResolvedConfig;
}
/** Pattern for the integration key. Ruleset keys start with `R`; same shape. */
export declare const ROUTING_KEY_PATTERN: RegExp;
export declare const SOURCE_PATTERN: RegExp;
export declare const ALERT_ID_PATTERN: RegExp;
/**
 * Validate a platform configuration block.
 *
 * Never throws: the platform needs the errors and warnings in order to report
 * them, and a configuration problem should produce a diagnosable log rather
 * than an exception during Homebridge startup.
 */
export declare function validateConfig(raw: unknown): ConfigValidationResult;
/** `Leak` for a single level, `Freezer Critical` otherwise, within HomeKit's budget. */
export declare function defaultLevelName(alertName: string, severity: Severity, levelCount: number): string;
/**
 * Resolve the diagnostics heartbeat interval.
 *
 * `0` and anything not a number is off. Values between 1 and 29 clamp up to
 * 30 so a typo does not silently disable the heartbeat.
 */
export declare function resolveDiagnosticsIntervalSec(value: unknown, warnings?: string[]): number;
/**
 * Expand a configuration into the accessories to expose.
 *
 * Two tiles sharing a name still work but make Siri ambiguous, so duplicates
 * are warned about once here.
 */
export declare function resolveAccessories(config: ResolvedConfig, warnings?: string[]): ResolvedAccessory[];
