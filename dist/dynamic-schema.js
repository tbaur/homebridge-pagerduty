"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The settings screen, rebuilt with a Plugin Signals section.
 *
 * `config.schema.json` sets `dynamicSchemaVersion`, so Config UI X reads the
 * file written here instead, from the storage directory. It is the static
 * schema plus one entry per plugin that writes signals or is in config.
 *
 * Everything another plugin wrote is untrusted. Names are limited to the
 * characters the signal store allows, which is what makes them safe in layout
 * keys and condition code. A plugin's text is only ever a field's default
 * value, never a title or description, which Config UI X renders as markup.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicSchemaWriter = exports.PLUGIN_SIGNALS_TITLE = void 0;
exports.buildDynamicSchema = buildDynamicSchema;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const schema_1 = require("./signals/schema");
const settings_1 = require("./settings");
const atomic_file_1 = require("./utils/atomic-file");
const errors_1 = require("./utils/errors");
/** Title of the layout fieldset this file fills. A test asserts the static schema has it. */
exports.PLUGIN_SIGNALS_TITLE = 'Plugin Signals';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
/** Bootstrap classes that Config UI X loads. A box per plugin and a rule per signal show what belongs to what. */
const PLUGIN_FIELDSET_CLASS = 'border rounded px-3 pt-3 pb-0 mb-3';
const SIGNAL_FIELDSET_CLASS = 'border-start border-2 ps-3 mb-2';
/** Build the settings screen. Pure. */
function buildDynamicSchema(input) {
    const schema = structuredClone(input.baseSchema);
    delete schema.dynamicSchemaVersion;
    const plugins = collectPlugins(input.catalog, input.signalPlugins);
    const properties = schema.schema.properties;
    properties.signals = {
        title: exports.PLUGIN_SIGNALS_TITLE,
        type: 'object',
        properties: Object.fromEntries(plugins.map((entry) => [(0, schema_1.pluginConfigKey)(entry.plugin), pluginSchema(entry)])),
    };
    const fieldset = schema.layout.find((item) => item.title === exports.PLUGIN_SIGNALS_TITLE);
    if (fieldset !== undefined) {
        fieldset.items = plugins.map(pluginLayout);
    }
    return schema;
}
/**
 * Plugins in config come first, so the cap never hides settings the user has
 * saved. Then plugins that write signals, in name order.
 */
function collectPlugins(catalog, configured) {
    const byPlugin = new Map();
    for (const entry of configured) {
        byPlugin.set(entry.plugin, new Map(entry.signals.map((signal) => [signal.signal, undefined])));
    }
    for (const entry of [...catalog].sort(compareEntries)) {
        let signals = byPlugin.get(entry.plugin);
        if (signals === undefined && byPlugin.size < settings_1.MAX_SIGNAL_PLUGINS) {
            signals = new Map();
            byPlugin.set(entry.plugin, signals);
        }
        if (signals !== undefined && (signals.has(entry.signal) || signals.size < settings_1.MAX_SIGNALS_PER_PLUGIN)) {
            signals.set(entry.signal, cleanDefault(entry.summary));
        }
    }
    return [...byPlugin]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([plugin, signals]) => ({
        plugin,
        signals: [...signals]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([signal, summary]) => (summary === undefined ? { signal } : { signal, summary })),
    }));
}
function compareEntries(a, b) {
    return a.plugin.localeCompare(b.plugin) || a.signal.localeCompare(b.signal);
}
/** A plugin's text as a default value, or undefined when it would not pass validation as a title. */
function cleanDefault(summary) {
    const text = summary.trim();
    return text.length > 0 && text.length <= settings_1.MAX_SUMMARY_LENGTH && !CONTROL_CHARACTERS.test(text) ? text : undefined;
}
function pluginSchema(entry) {
    return {
        type: 'object',
        properties: {
            allow: {
                title: 'Allow this plugin to page',
                type: 'boolean',
                default: false,
                description: 'Only allow plugins that you trust. An allowed plugin can page you as often as it likes.',
            },
            signals: {
                type: 'object',
                properties: Object.fromEntries(entry.signals.map((signal) => [signal.signal, signalSchema(signal)])),
            },
        },
    };
}
function signalSchema(signal) {
    return {
        type: 'object',
        required: ['severity'],
        properties: {
            enabled: { title: 'Page for this signal', type: 'boolean', default: true },
            summary: {
                title: 'PagerDuty Message',
                type: 'string',
                maxLength: settings_1.MAX_SUMMARY_LENGTH,
                ...(signal.summary === undefined ? {} : { default: signal.summary }),
                description: "Sent to PagerDuty when the plugin raises this signal. Leave blank to use the plugin's text.",
            },
            severity: {
                title: 'Severity',
                type: 'string',
                enum: [settings_1.SEVERITY_FROM_PLUGIN, 'critical', 'error', 'warning', 'info'],
                default: settings_1.SEVERITY_FROM_PLUGIN,
            },
            bypassMaintenance: {
                title: 'Page During Maintenance',
                type: 'boolean',
                default: false,
                description: 'Page even while the maintenance switch is on.',
            },
            switch: {
                title: 'Create HomeKit Switch',
                type: 'boolean',
                default: false,
                description: 'On while the signal is active. Turn it on by hand to page.',
            },
            switchName: {
                title: 'Switch Name',
                type: 'string',
                maxLength: settings_1.MAX_NAME_LENGTH,
                default: (0, schema_1.defaultSignalSwitchName)(signal.signal),
                description: 'The name that HomeKit shows. You can rename it at any time, and it keeps its room and automations.',
            },
        },
    };
}
function pluginLayout(entry) {
    const key = JSON.stringify((0, schema_1.pluginConfigKey)(entry.plugin));
    return {
        type: 'fieldset',
        title: entry.plugin,
        htmlClass: PLUGIN_FIELDSET_CLASS,
        expandable: true,
        expanded: false,
        items: [
            `signals[${key}].allow`,
            ...entry.signals.map((signal) => signalLayout(key, signal.signal)),
        ],
    };
}
function signalLayout(pluginKey, signal) {
    const path = `signals[${pluginKey}].signals[${JSON.stringify(signal)}]`;
    const model = `model.signals?.[${pluginKey}]`;
    const settings = `${model}?.signals?.[${JSON.stringify(signal)}]`;
    return {
        type: 'fieldset',
        title: signal,
        htmlClass: SIGNAL_FIELDSET_CLASS,
        expandable: true,
        expanded: false,
        condition: { functionBody: `return ${model}?.allow === true;` },
        items: [
            `${path}.enabled`,
            `${path}.summary`,
            {
                key: `${path}.severity`,
                type: 'select',
                titleMap: [
                    { value: settings_1.SEVERITY_FROM_PLUGIN, name: 'Set by the plugin' },
                    { value: 'critical', name: 'Critical' },
                    { value: 'error', name: 'Error' },
                    { value: 'warning', name: 'Warning' },
                    { value: 'info', name: 'Info' },
                ],
            },
            {
                key: `${path}.bypassMaintenance`,
                condition: { functionBody: 'return model.maintenance?.switch === true;' },
            },
            `${path}.switch`,
            {
                key: `${path}.switchName`,
                condition: { functionBody: `return ${settings}?.switch === true;` },
            },
        ],
    };
}
/**
 * Writes the settings screen, one write at a time. A failed write is logged
 * and changes nothing else: the settings screen is a convenience, and paging
 * never depends on it.
 */
class DynamicSchemaWriter {
    options;
    pending = Promise.resolve();
    constructor(options) {
        this.options = options;
    }
    /** Resolves once every queued write has finished. Never rejects. */
    flush() {
        return this.pending;
    }
    /** Queue a write. The returned promise never rejects. */
    write(input) {
        this.pending = this.pending.then(() => this.writeNow(input));
        return this.pending;
    }
    async writeNow(input) {
        const path = (0, node_path_1.join)(this.options.storageDir, settings_1.DYNAMIC_SCHEMA_FILE_NAME);
        try {
            const baseSchema = (this.options.readBaseSchema ?? readBaseSchema)();
            const schema = buildDynamicSchema({ ...input, baseSchema });
            await (this.options.write ?? writeSchemaFile)(path, schema);
        }
        catch (error) {
            this.options.log.warn(`could not update the settings screen (${(0, errors_1.describeError)(error)}); Plugin Signals may be out of date`);
        }
    }
}
exports.DynamicSchemaWriter = DynamicSchemaWriter;
function readBaseSchema() {
    return JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', 'config.schema.json'), 'utf8'));
}
function writeSchemaFile(path, value) {
    return (0, atomic_file_1.writeJsonAtomic)(path, value, settings_1.PRIVATE_FILE_MODE);
}
