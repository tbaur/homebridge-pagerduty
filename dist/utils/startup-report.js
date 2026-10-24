"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatStartupReport = formatStartupReport;
const config_1 = require("../signals/config");
const redact_1 = require("./redact");
/** Longest signal list printed for one plugin; the rest are counted. */
const MAX_LISTED_SIGNALS = 20;
/** Build the startup report, one log line per entry. */
function formatStartupReport(input) {
    const { config, accessories, changes } = input;
    const lines = [platformLine(input)];
    for (const alert of config.alerts) {
        const switches = accessories.filter((accessory) => accessory.kind === 'alert' && accessory.alertId === alert.id);
        const notes = [
            alert.levels.map((level) => level.severity).join(', '),
            ...newNotes(switches, changes),
            ...renameNotes(switches, changes),
        ];
        lines.push(`Alert switch: ${alert.id} "${(0, redact_1.forLog)(alert.summary)}" (${notes.join('; ')})`);
    }
    for (const id of config.heldAlertIds) {
        lines.push(`Alert switch: ${id} held until its entry is fixed; its switches show No Response`);
    }
    if (input.catalog !== undefined) {
        for (const [plugin, written] of signalsByPlugin(input.catalog, config)) {
            lines.push(signalLine(plugin, written, config));
        }
    }
    for (const accessory of accessories) {
        if (accessory.kind === 'signal' && accessory.signal !== undefined) {
            lines.push(`Signal switch: ${nameOf(accessory, changes)} for ${accessory.signal.plugin}/${accessory.signal.signal}`);
        }
        else if (accessory.kind === 'maintenance') {
            lines.push(`Maintenance switch: ${nameOf(accessory, changes)}; turns off after ${config.maintenance.maxMinutes} min`);
        }
        else if (accessory.kind === 'delivery') {
            lines.push(`Delivery sensor: ${nameOf(accessory, changes)}`);
        }
    }
    return lines;
}
function platformLine({ config, pluginVersion }) {
    const parts = [`region ${config.region.toUpperCase()}`, `source ${config.source}`];
    const allowed = (0, config_1.allowedPlugins)(config).length;
    if (allowed > 0) {
        parts.push(`plugins allowed ${allowed}`);
    }
    const mode = config.options.dryRun ? ' (dry run: nothing is sent)' : '';
    return `Starting v${pluginVersion}${mode}: ${parts.join(', ')}`;
}
/** Signal names by plugin, for every plugin that writes signals or is allowed. */
function signalsByPlugin(catalog, config) {
    const grouped = new Map((0, config_1.allowedPlugins)(config).map((plugin) => [plugin, []]));
    for (const entry of catalog) {
        grouped.set(entry.plugin, [...grouped.get(entry.plugin) ?? [], entry.signal]);
    }
    return new Map([...grouped].sort(([a], [b]) => a.localeCompare(b)));
}
/** What a plugin has written, and whether anything it writes can page. */
function signalLine(plugin, written, config) {
    const parts = [written.length > 0 ? listSignals(written) : 'none written yet'];
    if (!(0, config_1.allowedPlugins)(config).includes(plugin)) {
        parts.push('not allowed, so nothing is paged');
    }
    else {
        const muted = written.filter((signal) => (0, config_1.signalSettings)(config, { plugin, signal })?.enabled === false);
        if (muted.length > 0) {
            parts.push(`muted: ${listSignals(muted)}`);
        }
    }
    return `Signals from ${plugin}: ${parts.join('; ')}`;
}
function listSignals(names) {
    const listed = names.slice(0, MAX_LISTED_SIGNALS).map(redact_1.forLog).join(', ');
    const rest = names.length - MAX_LISTED_SIGNALS;
    return rest > 0 ? `${listed} and ${rest} more` : listed;
}
/** `new` when every switch was created on this start, otherwise the names of the ones that were. */
function newNotes(switches, changes) {
    const created = switches.filter((accessory) => changes.created.has(accessory));
    if (created.length === 0) {
        return [];
    }
    if (created.length === switches.length) {
        return ['new'];
    }
    return [`new ${created.map((accessory) => (0, redact_1.forLog)(accessory.name)).join(', ')}`];
}
function renameNotes(switches, changes) {
    const renames = switches.flatMap((accessory) => {
        const oldName = changes.renamed.get(accessory);
        return oldName === undefined ? [] : [`${(0, redact_1.forLog)(oldName)} to ${(0, redact_1.forLog)(accessory.name)}`];
    });
    return renames.length > 0 ? [`renamed ${renames.join(', ')}`] : [];
}
function nameOf(accessory, changes) {
    const name = (0, redact_1.forLog)(accessory.name);
    const oldName = changes.renamed.get(accessory);
    if (oldName !== undefined) {
        return `${name} (renamed from ${(0, redact_1.forLog)(oldName)})`;
    }
    return changes.created.has(accessory) ? `${name} (new)` : name;
}
