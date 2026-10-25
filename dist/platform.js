"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The platform: accessory lifecycle and wiring.
 *
 * It owns two things and delegates everything else to the controller.
 *
 * **Which accessories exist.** Configuration is validated once, expanded into
 * a list of accessories, and reconciled against what Homebridge restored from
 * its cache. Adopting a restored accessory rather than recreating it is what
 * keeps a tile attached to its room, its scenes and its automations.
 *
 * **What happens when configuration is unusable.** The platform disables
 * itself and leaves cached accessories registered, so HomeKit shows No
 * Response instead of losing the rooms built on them. Only a usable config
 * unregisters anything: an alert switch when its alert `id` is removed, and a
 * signal switch when its box is unchecked, its signal is muted, or its plugin
 * is no longer allowed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagerDutyPlatform = void 0;
const controller_1 = require("./controller");
const devices_1 = require("./devices");
const collector_1 = require("./diagnostics/collector");
const dynamic_schema_1 = require("./dynamic-schema");
const format_1 = require("./diagnostics/format");
const settings_1 = require("./settings");
const utils_1 = require("./utils");
/**
 * APIs that already have a running instance.
 *
 * Two instances in one process would share one state file and generate the
 * same UUIDs. `config.schema.json` sets `singular`, so this only catches a
 * hand-edited config.json.
 */
const runningInstances = new WeakSet();
const MODELS = {
    alert: 'Alert Switch',
    signal: 'Signal Switch',
    maintenance: 'Maintenance Switch',
    delivery: 'Delivery Sensor',
};
/** Homebridge's dynamic platform for PagerDuty alerts. */
class PagerDutyPlatform {
    api;
    log;
    pluginVersion;
    restored = new Map();
    handlers = new Map();
    diagnostics;
    controller;
    schemaWriter;
    config;
    diagnosticsTimer;
    lastDiagnosticsHealth = null;
    constructor(log, platformConfig, api) {
        this.log = log;
        this.api = api;
        this.pluginVersion = (0, settings_1.readPluginVersion)(log);
        this.diagnostics = new collector_1.DiagnosticsCollector({
            pluginVersion: this.pluginVersion,
            config: platformConfig,
        });
        if (runningInstances.has(api)) {
            this.log.error('a second PagerDuty platform is configured; only one is supported per Homebridge. This one is disabled');
            return;
        }
        runningInstances.add(api);
        const result = (0, utils_1.validateConfig)(platformConfig);
        for (const warning of result.warnings) {
            this.log.warn(warning);
        }
        if (result.status !== 'ok' || result.config === undefined) {
            if (result.status === 'notConfigured') {
                this.log.info('no routingKey set; PagerDuty is not started');
            }
            else {
                for (const error of result.errors) {
                    this.log.error(error);
                }
                this.log.error('platform disabled; cached accessories kept');
            }
            api.on('didFinishLaunching', () => this.keepRestoredUnavailable());
            return;
        }
        const config = result.config;
        this.config = config;
        api.on('didFinishLaunching', () => this.start(config));
        api.on('shutdown', () => {
            void this.stop();
        });
    }
    get hap() {
        return this.api.hap;
    }
    /** Homebridge hands back every accessory it restored from its cache. */
    configureAccessory(accessory) {
        this.restored.set(accessory.UUID, accessory);
    }
    // --- Lifecycle ---------------------------------------------------------------
    start(config) {
        const controller = new controller_1.AlertController({
            config,
            log: this.log,
            storageDir: this.api.user.storagePath(),
            pluginVersion: this.pluginVersion,
            onRequest: (durationMs, ok) => this.diagnostics.apiRequest(durationMs, ok),
        });
        try {
            controller.start();
        }
        catch (error) {
            const why = error instanceof utils_1.StateUnreadableError ? 'saved state could not be loaded' : 'startup failed';
            this.log.error(`${why}: ${(0, utils_1.describeError)(error)}. Platform disabled; cached accessories kept`);
            this.keepRestoredUnavailable();
            return;
        }
        this.controller = controller;
        this.startSettingsScreen(controller, config);
        const warnings = [];
        const accessories = (0, utils_1.resolveAccessories)(config, warnings);
        for (const warning of warnings) {
            this.log.warn(warning);
        }
        const changes = this.syncAccessories(accessories, config.heldAlertIds);
        const report = (0, utils_1.formatStartupReport)({
            config,
            accessories,
            pluginVersion: this.pluginVersion,
            changes,
            catalog: controller.signalCatalog(),
        });
        for (const line of report) {
            this.log.info(line);
        }
        controller.onChange(() => this.refreshAll());
        this.refreshAll();
        this.startDiagnostics();
        this.log.info('Platform ready');
    }
    /** Keep the Plugin Signals section of the settings screen in line with the signal store. */
    startSettingsScreen(controller, config) {
        const writer = new dynamic_schema_1.DynamicSchemaWriter({ storageDir: this.api.user.storagePath(), log: this.log });
        this.schemaWriter = writer;
        const write = () => {
            void writer.write({ catalog: controller.signalCatalog() ?? [], signalPlugins: config.signalPlugins });
        };
        controller.onCatalogChange(write);
        write();
    }
    async stop() {
        this.stopDiagnostics();
        for (const handler of this.handlers.values()) {
            handler.stop();
        }
        this.handlers.clear();
        await this.controller?.stop();
        await this.schemaWriter?.flush();
    }
    /** Keep cached accessories registered, answering No Response. */
    keepRestoredUnavailable() {
        for (const accessory of this.restored.values()) {
            this.revive(accessory, true);
        }
        if (this.restored.size > 0) {
            this.log.warn(`${this.restored.size} cached accessory(ies) inactive`);
        }
    }
    /**
     * Bring the registered accessory set in line with configuration.
     *
     * Accessories of a held alert are neither adopted nor removed: they stay
     * registered and answer No Response until the entry is fixed.
     *
     * Returns which accessories were created and which were renamed, for the
     * startup report.
     */
    syncAccessories(resolved, heldAlertIds) {
        const wanted = new Map(resolved.map((accessory) => [this.uuidFor(accessory), accessory]));
        const stale = [];
        for (const [uuid, accessory] of this.restored) {
            if (wanted.has(uuid)) {
                continue;
            }
            const context = (0, utils_1.parseAccessoryContext)(accessory.context);
            if (context?.alertId !== undefined && heldAlertIds.includes(context.alertId)) {
                this.revive(accessory, true);
                continue;
            }
            this.log.info(`removing ${(0, utils_1.forLog)(accessory.displayName)}`);
            stale.push(accessory);
        }
        for (const accessory of stale) {
            this.restored.delete(accessory.UUID);
        }
        if (stale.length > 0) {
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        }
        const created = [];
        const changes = { created: new Set(), renamed: new Map() };
        for (const [uuid, accessory] of wanted) {
            const existing = this.restored.get(uuid);
            const platformAccessory = existing ?? new this.api.platformAccessory(accessory.name, uuid);
            const oldName = this.adopt(platformAccessory, accessory);
            if (existing === undefined) {
                created.push(platformAccessory);
                changes.created.add(accessory);
            }
            else if (oldName !== undefined) {
                changes.renamed.set(accessory, oldName);
            }
        }
        if (created.length > 0) {
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, created);
        }
        return changes;
    }
    /** Returns the previous name when the accessory had to be renamed. */
    adopt(accessory, resolved) {
        const context = (0, utils_1.bindAccessoryContext)(accessory, resolved);
        const oldName = accessory.displayName;
        const isRenamed = oldName !== resolved.name;
        if (isRenamed) {
            // Assigning `displayName` only changes the wrapper. Homebridge publishes
            // and restores the HAP accessory's name, so a cached tile keeps the old
            // one until `updateDisplayName` writes both.
            accessory.updateDisplayName(resolved.name);
        }
        this.restored.set(accessory.UUID, accessory);
        this.attachHandler(accessory, context, false);
        return isRenamed ? oldName : undefined;
    }
    /** Attach a handler to a cached accessory without touching its identity. */
    revive(accessory, unavailable) {
        const context = (0, utils_1.parseAccessoryContext)(accessory.context);
        if (context !== undefined) {
            this.attachHandler(accessory, context, unavailable);
        }
    }
    attachHandler(accessory, context, unavailable) {
        const init = {
            host: this,
            accessory,
            displayName: accessory.displayName,
            model: MODELS[context.kind],
            serialNumber: context.serialNumber,
            unavailable,
        };
        const handler = createHandler(init, context);
        this.handlers.get(accessory.UUID)?.stop();
        this.handlers.set(accessory.UUID, handler);
    }
    /** Seeded from the identity key alone: alert id plus severity, never a name. */
    uuidFor(accessory) {
        return this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${(0, utils_1.accessoryIdentityKey)(accessory)}`);
    }
    refreshAll() {
        for (const handler of this.handlers.values()) {
            try {
                handler.refresh();
            }
            catch (error) {
                this.log.debug(`${(0, utils_1.forLog)(handler.displayName)}: refresh failed: ${(0, utils_1.describeError)(error)}`);
            }
        }
    }
    // --- AccessoryHost --------------------------------------------------------------
    isLevelOn(alertId, severity) {
        return this.controller?.isLevelOn(alertId, severity) ?? false;
    }
    setLevel(alertId, severity, on) {
        this.controller?.setLevel(alertId, severity, on);
    }
    isSignalSwitchOn(signal) {
        return this.controller?.isSignalSwitchOn(signal) ?? false;
    }
    setSignalSwitch(signal, on) {
        this.controller?.setSignalSwitch(signal, on);
    }
    isMaintenanceOn() {
        return this.controller?.isMaintenanceOn() ?? false;
    }
    setMaintenance(on) {
        this.controller?.setMaintenance(on);
    }
    isDeliveryFault() {
        return this.controller?.isDeliveryFault() ?? false;
    }
    deliveryFaultReport() {
        return this.controller?.deliveryFaultReport() ?? 'none';
    }
    // --- Diagnostics -----------------------------------------------------------------
    gauges() {
        return this.controller?.gauges() ?? {
            openAlerts: 0, pending: 0, heldByMaintenance: 0, rejected: 0, deliveryFault: false, storeOk: null, outage: false,
        };
    }
    startDiagnostics() {
        const seconds = this.config?.options.diagnosticsInterval ?? 0;
        if (seconds <= 0 || this.diagnosticsTimer !== undefined) {
            return;
        }
        const report = this.diagnostics.snapshot('diagnostics.start', this.gauges());
        this.emitDiagnostic('info', report);
        this.lastDiagnosticsHealth = report.lifecycle.health;
        this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), seconds * 1_000);
        this.diagnosticsTimer.unref();
    }
    stopDiagnostics() {
        if (this.diagnosticsTimer === undefined) {
            return;
        }
        this.emitDiagnostic('info', this.diagnostics.snapshot('diagnostics.stop', this.gauges()));
        clearInterval(this.diagnosticsTimer);
        this.diagnosticsTimer = undefined;
    }
    diagnosticsHeartbeat() {
        try {
            const report = this.diagnostics.buildHeartbeat(this.gauges());
            this.emitDiagnostic('info', report);
            const health = report.lifecycle.health;
            if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
                const isDegraded = health === 'degraded';
                this.emitDiagnostic(isDegraded ? 'warn' : 'info', {
                    ...report,
                    msg: isDegraded ? 'health.degraded' : 'health.recovered',
                }, true);
            }
            this.lastDiagnosticsHealth = health;
        }
        catch (error) {
            this.log.debug(`diagnostics heartbeat failed: ${(0, utils_1.describeError)(error)}`);
        }
    }
    emitDiagnostic(level, report, concise = false) {
        this.log[level](concise ? (0, format_1.formatHealthTransitionLine)(report) : (0, format_1.formatDiagnosticLine)(report));
        if (this.config?.options.structuredLogs === true) {
            this.log[level](JSON.stringify(report));
        }
    }
}
exports.PagerDutyPlatform = PagerDutyPlatform;
/** `parseAccessoryContext` guarantees the identity fields for its kind. */
function createHandler(init, context) {
    if (context.kind === 'alert' && context.alertId !== undefined && context.severity !== undefined) {
        return new devices_1.AlertSwitch({ ...init, alertId: context.alertId, severity: context.severity });
    }
    if (context.kind === 'signal' && context.signal !== undefined) {
        return new devices_1.SignalSwitch({ ...init, signal: context.signal });
    }
    return context.kind === 'maintenance' ? new devices_1.MaintenanceSwitch(init) : new devices_1.DeliverySensor(init);
}
