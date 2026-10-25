"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Lookups over the validated `signals` settings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedPlugins = allowedPlugins;
exports.signalSettings = signalSettings;
exports.requestedSignalSwitches = requestedSignalSwitches;
exports.signalSwitches = signalSwitches;
const settings_1 = require("../settings");
const schema_1 = require("./schema");
/** The plugins allowed to page. */
function allowedPlugins(config) {
    return config.signalPlugins.filter((entry) => entry.allow).map((entry) => entry.plugin);
}
/**
 * The settings for a signal, or undefined when its plugin may not page.
 *
 * A signal that an allowed plugin starts writing after the user saved the
 * settings screen pages with the defaults, as if every box were left alone.
 */
function signalSettings(config, ref) {
    const entry = config.signalPlugins.find((candidate) => candidate.plugin === ref.plugin && candidate.allow);
    if (entry === undefined) {
        return undefined;
    }
    return entry.signals.find((candidate) => candidate.signal === ref.signal) ?? {
        plugin: ref.plugin,
        signal: ref.signal,
        enabled: true,
        bypassMaintenance: false,
        switch: false,
        switchName: (0, schema_1.defaultSignalSwitchName)(ref.signal),
    };
}
/** Every signal that asks for a switch, ignoring the cap. */
function requestedSignalSwitches(config) {
    return config.signalPlugins
        .filter((entry) => entry.allow)
        .flatMap((entry) => entry.signals.filter((signal) => signal.enabled && signal.switch));
}
/** The signals that get a switch: those that ask for one, up to the cap. */
function signalSwitches(config) {
    return requestedSignalSwitches(config).slice(0, settings_1.MAX_SIGNAL_SWITCHES);
}
