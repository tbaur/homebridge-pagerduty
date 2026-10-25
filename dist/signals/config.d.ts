/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Lookups over the validated `signals` settings.
 */
import type { ResolvedConfig, ResolvedSignal, SignalRef } from '../types';
type SignalConfig = Pick<ResolvedConfig, 'signalPlugins'>;
/** The plugins allowed to page. */
export declare function allowedPlugins(config: SignalConfig): string[];
/**
 * The settings for a signal, or undefined when its plugin may not page.
 *
 * A signal that an allowed plugin starts writing after the user saved the
 * settings screen pages with the defaults, as if every box were left alone.
 */
export declare function signalSettings(config: SignalConfig, ref: SignalRef): ResolvedSignal | undefined;
/** Every signal that asks for a switch, ignoring the cap. */
export declare function requestedSignalSwitches(config: SignalConfig): ResolvedSignal[];
/** The signals that get a switch: those that ask for one, up to the cap. */
export declare function signalSwitches(config: SignalConfig): ResolvedSignal[];
export {};
