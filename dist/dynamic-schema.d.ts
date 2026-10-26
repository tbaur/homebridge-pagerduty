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
import { type CatalogEntry, type PluginLogger, type ResolvedSignalPlugin } from './types';
/** Title of the layout fieldset this file fills. A test asserts the static schema has it. */
export declare const PLUGIN_SIGNALS_TITLE = "Plugin Signals";
type JsonObject = Record<string, unknown>;
/** What the settings screen is built from. */
export interface DynamicSchemaInput {
    /** `config.schema.json`, parsed. Not modified. */
    baseSchema: JsonObject;
    catalog: readonly CatalogEntry[];
    signalPlugins: readonly ResolvedSignalPlugin[];
}
/** Build the settings screen. Pure. */
export declare function buildDynamicSchema(input: DynamicSchemaInput): JsonObject;
/** Construction options for {@link DynamicSchemaWriter}. */
export interface DynamicSchemaWriterOptions {
    storageDir: string;
    log: PluginLogger;
    /** Defaults to `config.schema.json` in the package root. */
    readBaseSchema?: () => JsonObject;
    write?: (path: string, value: unknown) => Promise<void>;
}
/**
 * Writes the settings screen, one write at a time. A failed write is logged
 * and changes nothing else: the settings screen is a convenience, and paging
 * never depends on it.
 */
export declare class DynamicSchemaWriter {
    private readonly options;
    private pending;
    constructor(options: DynamicSchemaWriterOptions);
    /** Resolves once every queued write has finished. Never rejects. */
    flush(): Promise<void>;
    /** Queue a write. The returned promise never rejects. */
    write(input: Omit<DynamicSchemaInput, 'baseSchema'>): Promise<void>;
    private writeNow;
}
export {};
