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
    if (input.signalsWritten !== undefined) {
        for (const source of config.signalSources) {
            lines.push(signalLine(source, input.signalsWritten.get(source) ?? [], config));
        }
    }
    for (const accessory of accessories) {
        if (accessory.kind === 'maintenance') {
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
    if (config.signalSources.length > 0) {
        parts.push(`signal sources ${config.signalSources.length}`);
    }
    const mode = config.options.dryRun ? ' (dry run: nothing is sent)' : '';
    return `Starting v${pluginVersion}${mode}: ${parts.join(', ')}`;
}
/** What a listed plugin has written, and which of its signals the alerts follow. */
function signalLine(source, written, config) {
    const followed = config.alerts.flatMap((alert) => alert.signal?.plugin === source ? [alert.signal.signal] : []);
    const parts = [written.length > 0 ? listSignals(written) : 'none written yet'];
    const followedWritten = followed.filter((name) => written.includes(name));
    const followedMissing = followed.filter((name) => !written.includes(name));
    if (followedWritten.length > 0) {
        parts.push(`followed: ${followedWritten.map(redact_1.forLog).join(', ')}`);
    }
    if (followedMissing.length > 0) {
        parts.push(`followed but not written: ${followedMissing.map(redact_1.forLog).join(', ')}`);
    }
    return `Signals from ${source}: ${parts.join('; ')}`;
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
