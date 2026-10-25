/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Lookups over the validated `signals` settings.
 */

import { MAX_SIGNAL_SWITCHES } from '../settings'
import type { ResolvedConfig, ResolvedSignal, SignalRef } from '../types'
import { defaultSignalSwitchName } from './schema'

type SignalConfig = Pick<ResolvedConfig, 'signalPlugins'>

/** The plugins allowed to page. */
export function allowedPlugins(config: SignalConfig): string[] {
  return config.signalPlugins.filter((entry) => entry.allow).map((entry) => entry.plugin)
}

/**
 * The settings for a signal, or undefined when its plugin may not page.
 *
 * A signal that an allowed plugin starts writing after the user saved the
 * settings screen pages with the defaults, as if every box were left alone.
 */
export function signalSettings(config: SignalConfig, ref: SignalRef): ResolvedSignal | undefined {
  const entry = config.signalPlugins.find((candidate) => candidate.plugin === ref.plugin && candidate.allow)
  if (entry === undefined) {
    return undefined
  }
  return entry.signals.find((candidate) => candidate.signal === ref.signal) ?? {
    plugin: ref.plugin,
    signal: ref.signal,
    enabled: true,
    bypassMaintenance: false,
    switch: false,
    switchName: defaultSignalSwitchName(ref.signal),
  }
}

/** Every signal that asks for a switch, ignoring the cap. */
export function requestedSignalSwitches(config: SignalConfig): ResolvedSignal[] {
  return config.signalPlugins
    .filter((entry) => entry.allow)
    .flatMap((entry) => entry.signals.filter((signal) => signal.enabled && signal.switch))
}

/** The signals that get a switch: those that ask for one, up to the cap. */
export function signalSwitches(config: SignalConfig): ResolvedSignal[] {
  return requestedSignalSwitches(config).slice(0, MAX_SIGNAL_SWITCHES)
}
