"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALERT_ID_PATTERN = exports.SOURCE_PATTERN = exports.ROUTING_KEY_PATTERN = void 0;
exports.validateConfig = validateConfig;
exports.levelSwitchName = levelSwitchName;
exports.resolveDiagnosticsIntervalSec = resolveDiagnosticsIntervalSec;
exports.resolveAccessories = resolveAccessories;
const config_1 = require("../signals/config");
const schema_1 = require("../signals/schema");
const settings_1 = require("../settings");
const types_1 = require("../types");
const redact_1 = require("./redact");
/** Pattern for the integration key. Ruleset keys start with `R`; same shape. */
exports.ROUTING_KEY_PATTERN = /^[A-Za-z0-9]{32}$/;
exports.SOURCE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
exports.ALERT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LISTED_SKIPPED_SWITCHES = 5;
/**
 * Validate a platform configuration block.
 *
 * Never throws: the platform needs the errors and warnings in order to report
 * them, and a configuration problem should produce a diagnosable log rather
 * than an exception during Homebridge startup.
 */
function validateConfig(raw) {
    const errors = [];
    const warnings = [];
    if (typeof raw !== 'object' || raw === null) {
        return { status: 'invalid', errors: ['platform configuration is missing'], warnings };
    }
    const config = raw;
    const key = validateRoutingKey(config.routingKey, errors, warnings);
    if (key === 'absent') {
        return { status: 'notConfigured', errors, warnings };
    }
    const region = validateRegion(config.region, warnings);
    const source = validateSource(config.source, errors);
    const signalPlugins = validateSignalPlugins(config.signals, warnings);
    const { alerts, heldAlertIds } = validateAlerts(config.alerts, errors, warnings);
    const maintenance = {
        switch: config.maintenance?.switch === true,
        name: validateAccessoryName({
            value: config.maintenance?.name,
            label: 'maintenance.name',
            fallback: settings_1.DEFAULT_MAINTENANCE_NAME,
            warnings,
        }),
        maxMinutes: clampInteger({
            value: config.maintenance?.maxMinutes,
            label: 'maintenance.maxMinutes',
            range: [settings_1.MIN_MAINTENANCE_MAX_MINUTES, settings_1.MAX_MAINTENANCE_MAX_MINUTES],
            fallback: settings_1.DEFAULT_MAINTENANCE_MAX_MINUTES,
            warnings,
        }),
    };
    const options = validateOptions(config.options, warnings);
    if (errors.length > 0 || key === undefined || source === undefined) {
        return { status: 'invalid', errors, warnings };
    }
    return {
        status: 'ok',
        errors,
        warnings,
        config: { routingKey: key, region, source, alerts, heldAlertIds, maintenance, signalPlugins, options },
    };
}
function validateRoutingKey(value, errors, warnings) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return 'absent';
    }
    if (typeof value !== 'string') {
        errors.push('routingKey must be a string');
        return undefined;
    }
    const trimmed = value.trim();
    if (!exports.ROUTING_KEY_PATTERN.test(trimmed)) {
        errors.push('routingKey is not a 32-character PagerDuty integration key');
        return undefined;
    }
    if (trimmed !== value) {
        // Said without quoting anything. A pasted key often carries a newline.
        warnings.push('routingKey had surrounding whitespace; trimmed');
    }
    return trimmed;
}
function validateRegion(value, warnings) {
    if (value === undefined || value === 'us' || value === 'eu') {
        return value ?? 'us';
    }
    warnings.push(`region ${(0, redact_1.forLog)(value)} is not us or eu; using us`);
    return 'us';
}
/**
 * `source` is fatal when wrong rather than defaulted: it is part of every
 * `dedup_key`, and a silent fallback would orphan every open alert.
 */
function validateSource(value, errors) {
    if (value === undefined) {
        return settings_1.DEFAULT_SOURCE;
    }
    if (typeof value !== 'string' || !exports.SOURCE_PATTERN.test(value)) {
        errors.push('source must be 1-32 letters, digits, dot, underscore or hyphen');
        return undefined;
    }
    return value;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * `signals`: one entry per plugin, keyed by `pluginConfigKey`.
 *
 * A bad entry is skipped with a warning and never fails the config. The
 * settings screen for this section is built from other plugins' data, and
 * nothing in it may stop the user's own alerts from working.
 */
function validateSignalPlugins(value, warnings) {
    if (value === undefined) {
        return [];
    }
    if (!isPlainObject(value)) {
        warnings.push('signals is not an object; no plugin may page');
        return [];
    }
    const plugins = [];
    for (const [key, entry] of Object.entries(value)) {
        const plugin = (0, schema_1.pluginFromConfigKey)(key);
        if (key === 'sources' && Array.isArray(entry)) {
            warnings.push('signals.sources is no longer used; allow each plugin under Plugin Signals instead');
        }
        else if (plugin === undefined || !isPlainObject(entry)) {
            warnings.push(`signals: ${(0, redact_1.forLog)(key)} is not a package name with settings; skipped`);
        }
        else if (plugins.some((existing) => existing.plugin === plugin)) {
            warnings.push(`signals: ${plugin} appears twice; the second entry is skipped`);
        }
        else if (plugins.length >= settings_1.MAX_SIGNAL_PLUGINS) {
            warnings.push(`signals: at most ${settings_1.MAX_SIGNAL_PLUGINS} plugins are read; ${plugin} skipped`);
        }
        else {
            plugins.push(validateSignalPlugin(plugin, entry, warnings));
        }
    }
    return plugins;
}
function validateSignalPlugin(plugin, entry, warnings) {
    const label = `signals.${(0, schema_1.pluginConfigKey)(plugin)}`;
    if (entry.signals !== undefined && !isPlainObject(entry.signals)) {
        warnings.push(`${label}.signals is not an object; its signals use the plugin's settings`);
    }
    const signals = [];
    for (const [name, settings] of Object.entries(isPlainObject(entry.signals) ? entry.signals : {})) {
        if (!(0, schema_1.isValidSignalName)(name) || !isPlainObject(settings)) {
            warnings.push(`${label}: ${(0, redact_1.forLog)(name)} is not a signal name with settings; skipped`);
        }
        else if (signals.length >= settings_1.MAX_SIGNALS_PER_PLUGIN) {
            warnings.push(`${label}: at most ${settings_1.MAX_SIGNALS_PER_PLUGIN} signals are read; ${name} skipped`);
        }
        else {
            signals.push(validateSignalSettings({ plugin, signal: name }, settings, warnings));
        }
    }
    return { plugin, allow: entry.allow === true, signals };
}
function validateSignalSettings(ref, settings, warnings) {
    const label = `signals.${(0, schema_1.pluginConfigKey)(ref.plugin)}.signals.${ref.signal}`;
    const summary = validateSummaryOverride(settings.summary, `${label}.summary`, warnings);
    const severity = validateSeverityOverride(settings.severity, `${label}.severity`, warnings);
    return {
        ...ref,
        enabled: settings.enabled !== false,
        ...(summary === undefined ? {} : { summary }),
        ...(severity === undefined ? {} : { severity }),
        bypassMaintenance: settings.bypassMaintenance === true,
        switch: settings.switch === true,
        switchName: validateAccessoryName({
            value: settings.switchName,
            label: `${label}.switchName`,
            fallback: (0, schema_1.defaultSignalSwitchName)(ref.signal),
            warnings,
        }),
    };
}
/** Blank keeps the plugin's text. A bad value does too, with a warning. */
function validateSummaryOverride(value, label, warnings) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return undefined;
    }
    if (typeof value !== 'string') {
        warnings.push(`${label} is not text; using the plugin's text`);
        return undefined;
    }
    const problems = [];
    const summary = validateText({ value, field: label, max: settings_1.MAX_SUMMARY_LENGTH, problems });
    if (summary === undefined) {
        warnings.push(`${problems.join('; ')}; using the plugin's text`);
    }
    return summary;
}
function validateSeverityOverride(value, label, warnings) {
    if (value === undefined || value === settings_1.SEVERITY_FROM_PLUGIN || value === '') {
        return undefined;
    }
    if ((0, types_1.isSeverity)(value)) {
        return value;
    }
    warnings.push(`${label} ${(0, redact_1.forLog)(value)} is not a severity; using the plugin's`);
    return undefined;
}
function validateAlerts(value, errors, warnings) {
    const alerts = [];
    const heldAlertIds = [];
    if (value === undefined) {
        return { alerts, heldAlertIds };
    }
    if (!Array.isArray(value)) {
        errors.push('alerts must be a list');
        return { alerts, heldAlertIds };
    }
    if (value.length > settings_1.MAX_ALERTS) {
        errors.push(`at most ${settings_1.MAX_ALERTS} alerts are supported; found ${value.length}`);
        return { alerts, heldAlertIds };
    }
    const seen = new Set();
    value.forEach((entry, index) => {
        const outcome = validateAlert(entry, index, warnings);
        if (outcome.kind === 'skip') {
            return;
        }
        const id = outcome.kind === 'ok' ? outcome.alert.id : outcome.id;
        if (seen.has(id)) {
            warnings.push(`alerts[${index}] repeats id ${id}; skipping the duplicate`);
            return;
        }
        seen.add(id);
        if (outcome.kind === 'ok') {
            alerts.push(outcome.alert);
        }
        else {
            heldAlertIds.push(id);
        }
    });
    return { alerts, heldAlertIds };
}
function validateAlert(entry, index, warnings) {
    const label = `alerts[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
        warnings.push(`${label} is not an object; skipped`);
        return { kind: 'skip' };
    }
    const alert = entry;
    if (typeof alert.id !== 'string' || !exports.ALERT_ID_PATTERN.test(alert.id)) {
        warnings.push(`${label} has no usable id (lowercase letters, digits and hyphens, starting with a letter); skipped`);
        return { kind: 'skip' };
    }
    const id = alert.id;
    const problems = [];
    const name = validateText({ value: alert.name, field: 'name', max: settings_1.MAX_NAME_LENGTH, problems });
    const summary = validateText({ value: alert.summary, field: 'summary', max: settings_1.MAX_SUMMARY_LENGTH, problems });
    const levels = validateLevels(alert.levels, name ?? id, problems);
    const resolveAfterMinutes = validateMinutes(alert.resolveAfterMinutes, problems);
    if ('signal' in alert) {
        warnings.push(`alert ${id}: signal is no longer used, so its switch no longer follows a signal. If the switch is on, turn it off, or its PagerDuty alert stays open`);
    }
    if (name === undefined || summary === undefined || levels === undefined || problems.length > 0) {
        warnings.push(`alert ${id} is held until fixed (nothing is sent or removed): ${problems.join('; ')}`);
        return { kind: 'held', id };
    }
    if (hasLevelNames(alert.levels)) {
        warnings.push(`alert ${id}: level names are no longer used; each switch is named ${(0, redact_1.forLog)(name)} plus its severity`);
    }
    return {
        kind: 'ok',
        alert: {
            id,
            name,
            summary,
            levels,
            resolveAfterMinutes,
            bypassMaintenance: alert.bypassMaintenance === true,
        },
    };
}
function validateText(input) {
    const { value, field, max, problems } = input;
    if (typeof value !== 'string' || value.trim().length === 0) {
        problems.push(`${field} is missing`);
        return undefined;
    }
    const text = value.trim();
    if (settings_1.CONTROL_CHARACTERS.test(text)) {
        problems.push(`${field} contains control characters`);
        return undefined;
    }
    if (text.length > max) {
        problems.push(`${field} is longer than ${max} characters`);
        return undefined;
    }
    return text;
}
/** An optional accessory name. A bad value keeps the default rather than holding the accessory. */
function validateAccessoryName(input) {
    const { value, label, fallback, warnings } = input;
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return fallback;
    }
    if (typeof value !== 'string') {
        warnings.push(`${label} is not text; using ${(0, redact_1.forLog)(fallback)}`);
        return fallback;
    }
    const problems = [];
    const name = validateText({ value, field: label, max: settings_1.MAX_NAME_LENGTH, problems });
    if (name === undefined) {
        warnings.push(`${problems.join('; ')}; using ${(0, redact_1.forLog)(fallback)}`);
        return fallback;
    }
    return name;
}
/** Each level is a switch named with the alert's prefix and its severity, so the name always says which switch it is. */
function validateLevels(value, prefix, problems) {
    if (!Array.isArray(value) || value.length === 0 || value.length > settings_1.MAX_LEVELS) {
        problems.push(`levels must list 1 to ${settings_1.MAX_LEVELS} entries`);
        return undefined;
    }
    const severities = [];
    for (const entry of value) {
        const level = (typeof entry === 'object' && entry !== null ? entry : {});
        if (!(0, types_1.isSeverity)(level.severity) || severities.includes(level.severity)) {
            problems.push('each level needs a distinct severity: info, warning, error or critical');
            return undefined;
        }
        severities.push(level.severity);
    }
    return severities.map((severity) => ({ severity, name: levelSwitchName(prefix, severity) }));
}
function hasLevelNames(levels) {
    return Array.isArray(levels) && levels.some((level) => typeof level === 'object' && level !== null && 'name' in level);
}
/** `Leak Critical`, within HomeKit's budget. */
function levelSwitchName(prefix, severity) {
    const suffix = `${severity[0]?.toUpperCase() ?? ''}${severity.slice(1)}`;
    const combined = `${prefix} ${suffix}`;
    if (combined.length <= settings_1.MAX_NAME_LENGTH) {
        return combined;
    }
    return `${prefix.slice(0, settings_1.MAX_NAME_LENGTH - suffix.length - 2)}\u2026 ${suffix}`;
}
function validateMinutes(value, problems) {
    if (value === undefined) {
        return 0;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > settings_1.MAX_RESOLVE_AFTER_MINUTES) {
        problems.push(`resolveAfterMinutes must be a whole number from 0 to ${settings_1.MAX_RESOLVE_AFTER_MINUTES}`);
        return 0;
    }
    return value;
}
function validateOptions(value, warnings) {
    return {
        deliveryFaultSensor: value?.deliveryFaultSensor !== false,
        deliveryFaultSensorName: validateAccessoryName({
            value: value?.deliveryFaultSensorName,
            label: 'options.deliveryFaultSensorName',
            fallback: settings_1.DEFAULT_DELIVERY_SENSOR_NAME,
            warnings,
        }),
        dryRun: value?.dryRun === true,
        diagnosticsInterval: resolveDiagnosticsIntervalSec(value?.diagnosticsInterval, warnings),
        structuredLogs: value?.structuredLogs === true,
    };
}
function clampInteger(input) {
    const { value, label, range, fallback, warnings } = input;
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        warnings.push(`${label} is not a number; using ${fallback}`);
        return fallback;
    }
    const clamped = Math.min(range[1], Math.max(range[0], Math.round(value)));
    if (clamped !== value) {
        warnings.push(`${label} clamped to ${clamped}`);
    }
    return clamped;
}
/**
 * Resolve the diagnostics heartbeat interval.
 *
 * `0` and anything not a number is off. Values between 1 and 29 clamp up to
 * 30 so a typo does not silently disable the heartbeat.
 */
function resolveDiagnosticsIntervalSec(value, warnings) {
    if (value === undefined || value === 0) {
        return 0;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        warnings?.push('options.diagnosticsInterval is not a usable number; diagnostics stay off');
        return 0;
    }
    const rounded = Math.round(numeric);
    if (rounded === 0) {
        return 0;
    }
    const clamped = Math.min(settings_1.MAX_DIAGNOSTICS_INTERVAL_SEC, Math.max(settings_1.MIN_DIAGNOSTICS_INTERVAL_SEC, rounded));
    if (clamped !== numeric) {
        warnings?.push(`options.diagnosticsInterval clamped to ${clamped}s`);
    }
    return clamped;
}
/**
 * Expand a configuration into the accessories to expose.
 *
 * Two tiles sharing a name still work but make Siri ambiguous, so duplicates
 * are warned about once here.
 */
function resolveAccessories(config, warnings) {
    const accessories = [];
    for (const alert of config.alerts) {
        for (const level of alert.levels) {
            accessories.push({ kind: 'alert', name: level.name, alertId: alert.id, severity: level.severity });
        }
    }
    accessories.push(...resolveSignalSwitches(config, warnings));
    if (config.maintenance.switch) {
        accessories.push({ kind: 'maintenance', name: config.maintenance.name });
    }
    if (config.options.deliveryFaultSensor) {
        accessories.push({ kind: 'delivery', name: config.options.deliveryFaultSensorName });
    }
    const counts = new Map();
    for (const accessory of accessories) {
        counts.set(accessory.name, (counts.get(accessory.name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
        if (count > 1) {
            warnings?.push(`duplicate name: ${(0, redact_1.forLog)(name)} (${count})`);
        }
    }
    return accessories;
}
/** A switch for each signal that asks for one, from allowed plugins only, up to the cap. */
function resolveSignalSwitches(config, warnings) {
    const skipped = (0, config_1.requestedSignalSwitches)(config).slice(settings_1.MAX_SIGNAL_SWITCHES);
    if (skipped.length > 0) {
        const names = skipped.slice(0, MAX_LISTED_SKIPPED_SWITCHES).map(schema_1.signalRefKey).join(', ');
        const rest = skipped.length - MAX_LISTED_SKIPPED_SWITCHES;
        warnings?.push(`at most ${settings_1.MAX_SIGNAL_SWITCHES} signal switches are created; skipped ${names}${rest > 0 ? ` and ${rest} more` : ''}`);
    }
    return (0, config_1.signalSwitches)(config).map((signal) => ({
        kind: 'signal',
        name: signal.switchName,
        signal: { plugin: signal.plugin, signal: signal.signal },
    }));
}
