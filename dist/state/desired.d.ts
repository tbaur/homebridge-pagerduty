/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Desired state, derived from configuration and persisted state.
 *
 * Pure. Every rule about alerts and levels lives here: an alert is open
 * while any level is on, its severity is the highest level
 * that is on, and a bound alert takes its severity from the last row seen.
 */
import type { ResolvedConfig } from '../types';
import type { DesiredTarget, PersistedState } from './model';
/** Every target that should exist, by target key. Absent means "should be closed". */
export declare function computeDesired(config: ResolvedConfig, state: PersistedState): Map<string, DesiredTarget>;
