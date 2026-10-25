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

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'

import { AlertController } from './controller'
import {
  AlertSwitch,
  DeliverySensor,
  MaintenanceSwitch,
  SignalSwitch,
  type AccessoryHost,
  type AccessoryInit,
  type BaseAccessory,
} from './devices'
import { DiagnosticsCollector } from './diagnostics/collector'
import { DynamicSchemaWriter } from './dynamic-schema'
import { formatDiagnosticLine, formatHealthTransitionLine } from './diagnostics/format'
import { PLATFORM_NAME, PLUGIN_NAME, readPluginVersion, UUID_PREFIX } from './settings'
import type {
  AccessoryContext,
  DeliveryGauges,
  DiagnosticsSnapshot,
  PagerDutyPlatformConfig,
  ResolvedAccessory,
  ResolvedConfig,
  Severity,
  SignalRef,
} from './types'
import {
  type AccessoryChanges,
  accessoryIdentityKey,
  bindAccessoryContext,
  describeError,
  forLog,
  formatStartupReport,
  parseAccessoryContext,
  resolveAccessories,
  StateUnreadableError,
  validateConfig,
} from './utils'

/**
 * APIs that already have a running instance.
 *
 * Two instances in one process would share one state file and generate the
 * same UUIDs. `config.schema.json` sets `singular`, so this only catches a
 * hand-edited config.json.
 */
const runningInstances = new WeakSet<API>()

const MODELS: Record<AccessoryContext['kind'], string> = {
  alert: 'Alert Switch',
  signal: 'Signal Switch',
  maintenance: 'Maintenance Switch',
  delivery: 'Delivery Sensor',
}

/** Homebridge's dynamic platform for PagerDuty alerts. */
export class PagerDutyPlatform implements DynamicPlatformPlugin, AccessoryHost {
  readonly api: API

  readonly log: Logging

  readonly pluginVersion: string

  private readonly restored = new Map<string, PlatformAccessory>()

  private readonly handlers = new Map<string, BaseAccessory>()

  private readonly diagnostics: DiagnosticsCollector

  private controller: AlertController | undefined

  private schemaWriter: DynamicSchemaWriter | undefined

  private config: ResolvedConfig | undefined

  private diagnosticsTimer: ReturnType<typeof setInterval> | undefined

  private lastDiagnosticsHealth: 'healthy' | 'degraded' | null = null

  constructor(log: Logging, platformConfig: PlatformConfig, api: API) {
    this.log = log
    this.api = api
    this.pluginVersion = readPluginVersion(log)
    this.diagnostics = new DiagnosticsCollector({
      pluginVersion: this.pluginVersion,
      config: platformConfig as PagerDutyPlatformConfig,
    })
    if (runningInstances.has(api)) {
      this.log.error('a second PagerDuty platform is configured; only one is supported per Homebridge. This one is disabled')
      return
    }
    runningInstances.add(api)

    const result = validateConfig(platformConfig)
    for (const warning of result.warnings) {
      this.log.warn(warning)
    }
    if (result.status !== 'ok' || result.config === undefined) {
      if (result.status === 'notConfigured') {
        this.log.info('no routingKey set; PagerDuty is not started')
      } else {
        for (const error of result.errors) {
          this.log.error(error)
        }
        this.log.error('platform disabled; cached accessories kept')
      }
      api.on('didFinishLaunching', () => this.keepRestoredUnavailable())
      return
    }
    const config = result.config
    this.config = config
    api.on('didFinishLaunching', () => this.start(config))
    api.on('shutdown', () => {
      void this.stop()
    })
  }

  get hap(): API['hap'] {
    return this.api.hap
  }

  /** Homebridge hands back every accessory it restored from its cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.restored.set(accessory.UUID, accessory)
  }

  // --- Lifecycle ---------------------------------------------------------------

  private start(config: ResolvedConfig): void {
    const controller = new AlertController({
      config,
      log: this.log,
      storageDir: this.api.user.storagePath(),
      pluginVersion: this.pluginVersion,
      onRequest: (durationMs, ok) => this.diagnostics.apiRequest(durationMs, ok),
    })
    try {
      controller.start()
    } catch (error) {
      const why = error instanceof StateUnreadableError ? 'saved state could not be loaded' : 'startup failed'
      this.log.error(`${why}: ${describeError(error)}. Platform disabled; cached accessories kept`)
      this.keepRestoredUnavailable()
      return
    }
    this.controller = controller
    this.startSettingsScreen(controller, config)
    const warnings: string[] = []
    const accessories = resolveAccessories(config, warnings)
    for (const warning of warnings) {
      this.log.warn(warning)
    }
    const changes = this.syncAccessories(accessories, config.heldAlertIds)
    const report = formatStartupReport({
      config,
      accessories,
      pluginVersion: this.pluginVersion,
      changes,
      catalog: controller.signalCatalog(),
    })
    for (const line of report) {
      this.log.info(line)
    }
    controller.onChange(() => this.refreshAll())
    this.refreshAll()
    this.startDiagnostics()
    this.log.info('Platform ready')
  }

  /** Keep the Plugin Signals section of the settings screen in line with the signal store. */
  private startSettingsScreen(controller: AlertController, config: ResolvedConfig): void {
    const writer = new DynamicSchemaWriter({ storageDir: this.api.user.storagePath(), log: this.log })
    this.schemaWriter = writer
    const write = (): void => {
      void writer.write({ catalog: controller.signalCatalog() ?? [], signalPlugins: config.signalPlugins })
    }
    controller.onCatalogChange(write)
    write()
  }

  private async stop(): Promise<void> {
    this.stopDiagnostics()
    for (const handler of this.handlers.values()) {
      handler.stop()
    }
    this.handlers.clear()
    await this.controller?.stop()
    await this.schemaWriter?.flush()
  }

  /** Keep cached accessories registered, answering No Response. */
  private keepRestoredUnavailable(): void {
    for (const accessory of this.restored.values()) {
      this.revive(accessory, true)
    }
    if (this.restored.size > 0) {
      this.log.warn(`${this.restored.size} cached accessory(ies) inactive`)
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
  private syncAccessories(
    resolved: readonly ResolvedAccessory[],
    heldAlertIds: readonly string[],
  ): AccessoryChanges {
    const wanted = new Map(resolved.map((accessory) => [this.uuidFor(accessory), accessory]))
    const stale: PlatformAccessory[] = []
    for (const [uuid, accessory] of this.restored) {
      if (wanted.has(uuid)) {
        continue
      }
      const context = parseAccessoryContext(accessory.context)
      if (context?.alertId !== undefined && heldAlertIds.includes(context.alertId)) {
        this.revive(accessory, true)
        continue
      }
      this.log.info(`removing ${forLog(accessory.displayName)}`)
      stale.push(accessory)
    }
    for (const accessory of stale) {
      this.restored.delete(accessory.UUID)
    }
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale)
    }
    const created: PlatformAccessory[] = []
    const changes = { created: new Set<ResolvedAccessory>(), renamed: new Map<ResolvedAccessory, string>() }
    for (const [uuid, accessory] of wanted) {
      const existing = this.restored.get(uuid)
      const platformAccessory = existing ?? new this.api.platformAccessory(accessory.name, uuid)
      const oldName = this.adopt(platformAccessory, accessory)
      if (existing === undefined) {
        created.push(platformAccessory)
        changes.created.add(accessory)
      } else if (oldName !== undefined) {
        changes.renamed.set(accessory, oldName)
      }
    }
    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created)
    }
    return changes
  }

  /** Returns the previous name when the accessory had to be renamed. */
  private adopt(accessory: PlatformAccessory, resolved: ResolvedAccessory): string | undefined {
    const context = bindAccessoryContext(accessory, resolved)
    const oldName = accessory.displayName
    const isRenamed = oldName !== resolved.name
    if (isRenamed) {
      // Assigning `displayName` only changes the wrapper. Homebridge publishes
      // and restores the HAP accessory's name, so a cached tile keeps the old
      // one until `updateDisplayName` writes both.
      accessory.updateDisplayName(resolved.name)
    }
    this.restored.set(accessory.UUID, accessory)
    this.attachHandler(accessory, context, false)
    return isRenamed ? oldName : undefined
  }

  /** Attach a handler to a cached accessory without touching its identity. */
  private revive(accessory: PlatformAccessory, unavailable: boolean): void {
    const context = parseAccessoryContext(accessory.context)
    if (context !== undefined) {
      this.attachHandler(accessory, context, unavailable)
    }
  }

  private attachHandler(accessory: PlatformAccessory, context: AccessoryContext, unavailable: boolean): void {
    const init: AccessoryInit = {
      host: this,
      accessory,
      displayName: accessory.displayName,
      model: MODELS[context.kind],
      serialNumber: context.serialNumber,
      unavailable,
    }
    const handler = createHandler(init, context)
    this.handlers.get(accessory.UUID)?.stop()
    this.handlers.set(accessory.UUID, handler)
  }

  /** Seeded from the identity key alone: alert id plus severity, never a name. */
  private uuidFor(accessory: ResolvedAccessory): string {
    return this.api.hap.uuid.generate(`${UUID_PREFIX}${accessoryIdentityKey(accessory)}`)
  }

  private refreshAll(): void {
    for (const handler of this.handlers.values()) {
      try {
        handler.refresh()
      } catch (error) {
        this.log.debug(`${forLog(handler.displayName)}: refresh failed: ${describeError(error)}`)
      }
    }
  }

  // --- AccessoryHost --------------------------------------------------------------

  isLevelOn(alertId: string, severity: Severity): boolean {
    return this.controller?.isLevelOn(alertId, severity) ?? false
  }

  setLevel(alertId: string, severity: Severity, on: boolean): void {
    this.controller?.setLevel(alertId, severity, on)
  }

  isSignalSwitchOn(signal: SignalRef): boolean {
    return this.controller?.isSignalSwitchOn(signal) ?? false
  }

  setSignalSwitch(signal: SignalRef, on: boolean): void {
    this.controller?.setSignalSwitch(signal, on)
  }

  isMaintenanceOn(): boolean {
    return this.controller?.isMaintenanceOn() ?? false
  }

  setMaintenance(on: boolean): void {
    this.controller?.setMaintenance(on)
  }

  isDeliveryFault(): boolean {
    return this.controller?.isDeliveryFault() ?? false
  }

  // --- Diagnostics -----------------------------------------------------------------

  private gauges(): DeliveryGauges {
    return this.controller?.gauges() ?? {
      openAlerts: 0, pending: 0, heldByMaintenance: 0, rejected: 0, deliveryFault: false, storeOk: null, outage: false,
    }
  }

  private startDiagnostics(): void {
    const seconds = this.config?.options.diagnosticsInterval ?? 0
    if (seconds <= 0 || this.diagnosticsTimer !== undefined) {
      return
    }
    const report = this.diagnostics.snapshot('diagnostics.start', this.gauges())
    this.emitDiagnostic('info', report)
    this.lastDiagnosticsHealth = report.lifecycle.health
    this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), seconds * 1_000)
    this.diagnosticsTimer.unref()
  }

  private stopDiagnostics(): void {
    if (this.diagnosticsTimer === undefined) {
      return
    }
    this.emitDiagnostic('info', this.diagnostics.snapshot('diagnostics.stop', this.gauges()))
    clearInterval(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
  }

  private diagnosticsHeartbeat(): void {
    try {
      const report = this.diagnostics.buildHeartbeat(this.gauges())
      this.emitDiagnostic('info', report)
      const health = report.lifecycle.health
      if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
        const isDegraded = health === 'degraded'
        this.emitDiagnostic(isDegraded ? 'warn' : 'info', {
          ...report,
          msg: isDegraded ? 'health.degraded' : 'health.recovered',
        }, true)
      }
      this.lastDiagnosticsHealth = health
    } catch (error) {
      this.log.debug(`diagnostics heartbeat failed: ${describeError(error)}`)
    }
  }

  private emitDiagnostic(level: 'info' | 'warn', report: DiagnosticsSnapshot, concise = false): void {
    this.log[level](concise ? formatHealthTransitionLine(report) : formatDiagnosticLine(report))
    if (this.config?.options.structuredLogs === true) {
      this.log[level](JSON.stringify(report))
    }
  }
}

/** `parseAccessoryContext` guarantees the identity fields for its kind. */
function createHandler(init: AccessoryInit, context: AccessoryContext): BaseAccessory {
  if (context.kind === 'alert' && context.alertId !== undefined && context.severity !== undefined) {
    return new AlertSwitch({ ...init, alertId: context.alertId, severity: context.severity })
  }
  if (context.kind === 'signal' && context.signal !== undefined) {
    return new SignalSwitch({ ...init, signal: context.signal })
  }
  return context.kind === 'maintenance' ? new MaintenanceSwitch(init) : new DeliverySensor(init)
}
