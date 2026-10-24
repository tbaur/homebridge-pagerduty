/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The alert controller: state, persistence, timers, the signal
 * poll and the sender, wired together.
 *
 * Every rule lives elsewhere: in `state/mutations.ts` (what a change does),
 * `state/desired.ts` and `state/reconcile.ts` (what must be sent), and
 * `delivery/sender.ts` (how). This file decides *when* each runs, persists the
 * result, and tells the platform that HomeKit should be refreshed.
 */

import { join } from 'node:path'

import { DeliveryHealth } from './delivery/health'
import { buildEvent } from './delivery/events'
import { postJson, type HttpResponse, type JsonPost } from './delivery/http'
import { Sender } from './delivery/sender'
import {
  CONNECT_TIMEOUT_MS,
  DATA_DIR_NAME,
  DELIVERY_HEALTH_TICK_MS,
  EVENTS_URLS,
  MAX_RESPONSE_BYTES,
  OUTAGE_REWARN_MS,
  REQUEST_TIMEOUT_MS,
  RETIRED_SIGNAL_STORES,
  SIGNAL_INTERFACE_ID,
  SIGNAL_POLL_MS,
  SIGNAL_STORE_FILE_NAME,
  STATE_FILE_NAME,
} from './settings'
import { allowedPlugins, signalSwitches } from './signals/config'
import { signalRefKey } from './signals/schema'
import { SignalReader, type PollResult } from './signals/reader'
import { findRetiredStoreWriters } from './signals/retired'
import { computeDesired } from './state/desired'
import type { PersistedState } from './state/model'
import { alertTargetKey, isSignalSwitchOn, levelKey } from './state/model'
import {
  applyKeyChange,
  applyLevelWrite,
  applyMaintenance,
  applyRows,
  applySignalSwitchWrite,
  expireResolveTimers,
  nextDeadline,
  pruneSignals,
} from './state/mutations'
import { reconcile, type Action, type Plan } from './state/reconcile'
import { fingerprintRoutingKey, StateStore } from './state/store'
import type { CatalogEntry, DeliveryGauges, PluginLogger, ResolvedAlert, ResolvedConfig, ResolvedSignal, Severity, SignalRef } from './types'
import { describeError } from './utils/errors'
import { forLog } from './utils/redact'
import type { InterruptibleSleep } from './utils/timing'

/** The reader surface the controller uses. A stand-in in tests. */
export interface SignalReaderLike {
  create(): void
  poll(): PollResult
  close(): void
}

/** Construction options for {@link AlertController}. */
export interface ControllerOptions {
  config: ResolvedConfig
  log: PluginLogger
  /** The Homebridge storage directory. Files go in its {@link DATA_DIR_NAME} subdirectory. */
  storageDir: string
  pluginVersion: string
  post?: JsonPost
  now?: () => number
  random?: () => number
  sleep?: (ms: number) => InterruptibleSleep
  store?: StateStore
  createReader?: (path: string, allowed: readonly string[]) => SignalReaderLike
  onRequest?: (durationMs: number, ok: boolean) => void
}

const EMPTY_PLAN: Plan = { sendable: [], heldByMaintenance: [], rejected: [] }

/** Owns desired and delivered state and keeps PagerDuty in line with it. */
export class AlertController {
  private readonly options: ControllerOptions
  private readonly config: ResolvedConfig
  private readonly log: PluginLogger
  private readonly now: () => number
  private readonly store: StateStore
  private readonly sender: Sender
  private readonly health = new DeliveryHealth()
  private readonly alertsById = new Map<string, ResolvedAlert>()
  private readonly allowed: readonly string[]
  /** Signals with a switch, by `<plugin>/<signal>`. */
  private readonly switches = new Map<string, ResolvedSignal>()
  private readonly listeners: (() => void)[] = []
  private readonly catalogListeners: (() => void)[] = []
  private readonly abort = new AbortController()
  private readonly knownForeignWriters = new Set<string>()
  private readonly outageGapKeys = new Set<string>()
  private state: PersistedState | undefined
  private plan: Plan = EMPTY_PLAN
  private fault = false
  private reader: SignalReaderLike | undefined
  private storeUnreadableSince: number | null = null
  private catalog: CatalogEntry[] | undefined
  private catalogNames = ''
  private lastStoreWarnAt = 0
  private pendingRowSweep = false
  private started = false
  private stopped = false
  private readonly timers: {
    deadline?: ReturnType<typeof setTimeout>
    poll?: ReturnType<typeof setInterval>
    health?: ReturnType<typeof setInterval>
  } = {}

  constructor(options: ControllerOptions) {
    this.options = options
    this.config = options.config
    this.log = options.log
    this.now = options.now ?? Date.now
    for (const alert of this.config.alerts) {
      this.alertsById.set(alert.id, alert)
    }
    this.allowed = allowedPlugins(this.config)
    for (const signal of signalSwitches(this.config)) {
      this.switches.set(signalRefKey(signal), signal)
    }
    this.store = options.store ?? new StateStore({
      path: join(options.storageDir, DATA_DIR_NAME, STATE_FILE_NAME),
      log: this.log,
      persistDelivery: !this.config.options.dryRun,
      now: this.now,
    })
    this.sender = new Sender({
      nextAction: () => this.reconcileNow().sendable[0],
      post: (action) => this.post(action),
      onDelivered: (action) => this.recordDelivered(action),
      onRejected: (action, reason) => this.recordRejected(action, reason),
      countSuperseded: (keys) => this.countSuperseded(keys),
      log: this.log,
      now: this.now,
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.onRequest === undefined ? {} : { onRequest: options.onRequest }),
    })
  }

  // --- Lifecycle ---------------------------------------------------------------

  /**
   * Load state and start delivering.
   *
   * Throws `StateUnreadableError` when the state directory cannot be created
   * or the state file exists but cannot be read; the platform then disables
   * itself.
   */
  start(): void {
    const loaded = this.store.load()
    const state = loaded.state
    this.state = state
    this.warnAboutKeyChange(applyKeyChange(state, fingerprintRoutingKey(this.config.routingKey)))
    if (loaded.outcome === 'corrupt') {
      this.sweepClosedAlerts()
      this.pendingRowSweep = this.allowed.length > 0
    }
    pruneSignals(state, { allowed: this.allowed, switches: new Set(this.switches.keys()) })
    this.forgetRemovedAlerts()
    if (state.maintenance.on && !this.config.maintenance.switch) {
      applyMaintenance(state, { on: false, at: this.now(), maxMinutes: this.config.maintenance.maxMinutes })
      this.log.info('maintenance ended: maintenance.switch is off in config')
    }
    this.handleDeadlines()
    this.persist()
    this.startSignals()
    this.timers.health = setInterval(() => this.updateFault(), DELIVERY_HEALTH_TICK_MS)
    this.timers.health.unref()
    this.started = true
    this.kick()
  }

  /** Stop timers and the sender, close the store, and finish writing state. */
  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timers.deadline)
    clearInterval(this.timers.poll)
    clearInterval(this.timers.health)
    this.abort.abort()
    await this.sender.stop()
    this.reader?.close()
    await this.store.flush()
  }

  /** Called after any change HomeKit should see. */
  onChange(listener: () => void): void {
    this.listeners.push(listener)
  }

  // --- HomeKit-facing ------------------------------------------------------------

  isLevelOn(alertId: string, severity: Severity): boolean {
    return this.requireState().levels[levelKey(alertId, severity)]?.on === true
  }

  /** A switch write. Updates desired state, persists it, wakes the sender and returns. */
  setLevel(alertId: string, severity: Severity, on: boolean): void {
    const alert = this.alertsById.get(alertId)
    if (alert === undefined || this.stopped) {
      return
    }
    const state = this.requireState()
    const wasOn = state.levels[levelKey(alertId, severity)]?.on === true
    if (!applyLevelWrite(state, alert, { severity, on, at: this.now() })) {
      return
    }
    if (wasOn !== on) {
      this.log.info(`${forLog(levelName(alert, severity))}: switched ${on ? 'on' : 'off'}`)
    }
    this.persist()
    this.scheduleDeadline()
    this.kick()
  }

  isMaintenanceOn(): boolean {
    return this.requireState().maintenance.on
  }

  setMaintenance(on: boolean): void {
    if (!this.config.maintenance.switch || this.stopped) {
      return
    }
    const { maxMinutes } = this.config.maintenance
    if (!applyMaintenance(this.requireState(), { on, at: this.now(), maxMinutes })) {
      return
    }
    this.log.info(on
      ? `maintenance on: new pages are held for up to ${maxMinutes} min; resolves still go out`
      : 'maintenance off: sending anything still active')
    this.persist()
    this.scheduleDeadline()
    this.kick()
  }

  isSignalSwitchOn(ref: SignalRef): boolean {
    return isSignalSwitchOn(this.requireState(), signalRefKey(ref))
  }

  /** A signal switch write. Pages or resolves with the signal's settings. */
  setSignalSwitch(ref: SignalRef, on: boolean): void {
    const key = signalRefKey(ref)
    const signal = this.switches.get(key)
    if (signal === undefined || this.stopped) {
      return
    }
    if (!applySignalSwitchWrite(this.requireState(), key, { on, at: this.now() })) {
      return
    }
    this.log.info(`${forLog(signal.switchName)}: switched ${on ? 'on' : 'off'}`)
    this.persist()
    this.kick()
  }

  isDeliveryFault(): boolean {
    return this.fault
  }

  /** Live counts for diagnostics. */
  gauges(): DeliveryGauges {
    return {
      openAlerts: Object.keys(this.requireState().delivered).length,
      pending: this.plan.sendable.length,
      heldByMaintenance: this.plan.heldByMaintenance.length,
      rejected: this.plan.rejected.length,
      deliveryFault: this.fault,
      storeOk: this.allowed.length === 0 ? null : this.storeUnreadableSince === null,
      outage: this.sender.inOutage,
    }
  }

  // --- Reconcile and send --------------------------------------------------------

  private kick(): void {
    this.reconcileNow()
    this.sender.wake()
    this.notify()
  }

  private reconcileNow(): Plan {
    const state = this.requireState()
    const plan = reconcile({
      desired: computeDesired(this.config, state),
      delivered: state.delivered,
      rejected: state.rejected,
      maintenanceOn: state.maintenance.on,
      hashContext: {
        routingKeyFingerprint: state.routingKeyFingerprint ?? '',
        region: this.config.region,
        pluginVersion: this.options.pluginVersion,
      },
    })
    this.pruneRejections(plan)
    this.health.observe(plan, this.now())
    if (this.sender.inOutage) {
      for (const action of plan.sendable) {
        if (action.kind === 'trigger') {
          this.outageGapKeys.add(action.key)
        }
      }
    }
    this.plan = plan
    this.updateFault()
    return plan
  }

  /** A rejection stops counting once the desired state no longer matches it. */
  private pruneRejections(plan: Plan): void {
    const state = this.requireState()
    const outstanding = new Set(plan.rejected)
    let pruned = false
    for (const key of Object.keys(state.rejected)) {
      if (!outstanding.has(key)) {
        delete state.rejected[key]
        pruned = true
      }
    }
    if (pruned) {
      this.persist()
    }
  }

  private post(action: Action): Promise<HttpResponse> {
    if (this.config.options.dryRun) {
      const what = action.kind === 'trigger' ? `trigger (${action.severity})` : 'resolve'
      this.log.info(`dry run: would send ${what} for ${forLog(action.label)} as ${forLog(action.dedupKey)}`)
      return Promise.resolve({ status: 202, body: '', headers: {} })
    }
    const body = buildEvent(action, { routingKey: this.config.routingKey, source: this.config.source })
    return (this.options.post ?? postJson)(EVENTS_URLS[this.config.region], body, {
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      totalTimeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      signal: this.abort.signal,
    })
  }

  /** Record what was *sent*, never the desired state at the moment the answer arrives. */
  private recordDelivered(action: Action): void {
    const state = this.requireState()
    if (action.kind === 'trigger') {
      const existing = state.delivered[action.key]
      state.delivered[action.key] = {
        dedupKey: action.dedupKey,
        severity: action.severity,
        openedAt: existing?.dedupKey === action.dedupKey ? existing.openedAt : this.now(),
      }
    } else if (state.delivered[action.key]?.dedupKey === action.dedupKey) {
      delete state.delivered[action.key]
    }
    delete state.rejected[action.key]
    this.persist()
    this.notify()
  }

  private recordRejected(action: Action, reason: string): void {
    this.requireState().rejected[action.key] = { desiredHash: action.hash, at: this.now(), reason }
    this.log.warn(`${forLog(action.label)}: PagerDuty rejected the ${action.kind}: ${reason}. Not retried until the alert changes`)
    this.persist()
    this.reconcileNow()
    this.notify()
  }

  /** Alerts that had an unsent trigger during the outage and are now closed with nothing delivered. */
  private countSuperseded(keys: ReadonlySet<string>): number {
    const state = this.requireState()
    const desired = computeDesired(this.config, state)
    let count = 0
    for (const key of new Set([...keys, ...this.outageGapKeys])) {
      if (desired.get(key)?.open !== true && state.delivered[key] === undefined) {
        count += 1
      }
    }
    this.outageGapKeys.clear()
    return count
  }

  // --- Timers --------------------------------------------------------------------

  private handleDeadlines(): void {
    const state = this.requireState()
    const now = this.now()
    let changed = false
    for (const alert of expireResolveTimers(state, this.config.alerts, now)) {
      this.log.info(`${forLog(alert.name)}: resolve timer expired; switched off`)
      changed = true
    }
    if (state.maintenance.on && state.maintenance.until !== null && state.maintenance.until <= now) {
      applyMaintenance(state, { on: false, at: now, maxMinutes: this.config.maintenance.maxMinutes })
      this.log.warn(`maintenance turned itself off after ${this.config.maintenance.maxMinutes} min; paging is back on`)
      changed = true
    }
    if (changed) {
      this.persist()
      if (this.started) {
        this.kick()
      }
    }
    this.scheduleDeadline()
  }

  private scheduleDeadline(): void {
    clearTimeout(this.timers.deadline)
    this.timers.deadline = undefined
    const deadline = nextDeadline(this.requireState(), this.config.alerts)
    if (deadline === undefined || this.stopped) {
      return
    }
    // setTimeout overflows past 2^31-1 ms and fires at once; re-arm instead.
    const delay = Math.min(Math.max(0, deadline - this.now()), 2_147_483_647)
    this.timers.deadline = setTimeout(() => this.handleDeadlines(), delay)
    this.timers.deadline.unref()
  }

  // --- Delivery sensor -------------------------------------------------------------

  private updateFault(): void {
    const fault = this.health.isFault({
      plan: this.plan,
      now: this.now(),
      storeUnreadableSince: this.storeUnreadableSince,
    })
    if (fault !== this.fault) {
      this.fault = fault
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.log.debug(`change listener failed: ${describeError(error)}`)
      }
    }
  }

  // --- Signal store ----------------------------------------------------------------

  /**
   * The store is polled even when no plugin is allowed, because the settings
   * screen lists every plugin that writes to it. It is created only when a
   * plugin is allowed, and a missing or broken store is a fault only then.
   */
  private startSignals(): void {
    const path = join(this.options.storageDir, DATA_DIR_NAME, SIGNAL_INTERFACE_ID, SIGNAL_STORE_FILE_NAME)
    const create = this.options.createReader
      ?? ((file, allowed) => new SignalReader({ path: file, allowed, log: this.log }))
    this.reader = create(path, this.allowed)
    if (this.allowed.length > 0) {
      try {
        this.reader.create()
      } catch (error) {
        this.noteStoreUnavailable(describeError(error))
      }
    }
    this.pollSignals()
    this.reportRetiredStores()
    this.timers.poll = setInterval(() => this.pollSignals(), SIGNAL_POLL_MS)
    this.timers.poll.unref()
  }

  /**
   * Names plugins that write only to a store this version no longer reads. A
   * plugin already in the current store has been updated, and is left out.
   */
  private reportRetiredStores(): void {
    const current = new Set((this.catalog ?? []).map((entry) => entry.plugin))
    for (const retired of findRetiredStoreWriters({ storageDir: this.options.storageDir, stores: RETIRED_SIGNAL_STORES, log: this.log })) {
      for (const plugin of retired.plugins.filter((name) => !current.has(name))) {
        this.log.warn(
          `signal store: ${forLog(plugin)} still writes to ${retired.store}, which this version does not read, so it cannot page. `
          + 'Update it. Once nothing writes to it, delete it and its -wal and -shm files',
        )
      }
    }
  }

  /**
   * Every plugin's signals at the last read, for the settings screen and the
   * startup report. Undefined when the store has not been read. A store that
   * does not exist yet reads as empty. The text is the other plugin's and is
   * untrusted.
   */
  signalCatalog(): readonly CatalogEntry[] | undefined {
    return this.catalog
  }

  /** Called when a plugin or signal appears in the store or leaves it. */
  onCatalogChange(listener: () => void): void {
    this.catalogListeners.push(listener)
  }

  private pollSignals(): void {
    const result = this.reader?.poll()
    if (result === undefined || this.stopped) {
      return
    }
    if (result.kind === 'unavailable') {
      if (result.reason === 'missing') {
        this.updateCatalog([])
      }
      if (this.allowed.length > 0) {
        this.noteStoreUnavailable(result.reason)
      } else if (result.reason !== 'missing') {
        this.log.debug(`signal store unavailable (${result.reason})`)
      }
      return
    }
    this.noteStoreAvailable()
    if (result.kind === 'rows') {
      this.updateCatalog(result.catalog)
      this.applySignalRows(result)
    }
  }

  private updateCatalog(catalog: CatalogEntry[]): void {
    this.catalog = catalog
    const names = catalog.map((entry) => signalRefKey(entry)).join('\n')
    if (names === this.catalogNames) {
      return
    }
    this.catalogNames = names
    for (const listener of this.catalogListeners) {
      try {
        listener()
      } catch (error) {
        this.log.debug(`catalog listener failed: ${describeError(error)}`)
      }
    }
  }

  private applySignalRows(result: Extract<PollResult, { kind: 'rows' }>): void {
    for (const entry of result.catalog) {
      if (!this.allowed.includes(entry.plugin) && !this.knownForeignWriters.has(entry.plugin)) {
        this.knownForeignWriters.add(entry.plugin)
        this.log.info(`signal store: ${forLog(entry.plugin)} writes signals; allow it under Plugin Signals to page for it`)
      }
    }
    if (result.invalidRows > 0) {
      this.log.debug(`signal store: ${result.invalidRows} row(s) failed validation and were ignored`)
    }
    if (!result.complete) {
      this.log.warn('signal store holds more rows than are read; rows that have gone are not cleared until it shrinks')
    }
    const state = this.requireState()
    const applied = applyRows(state, {
      rows: result.rows,
      complete: result.complete,
      allowed: this.allowed,
      switches: new Set(this.switches.keys()),
      now: this.now(),
    })
    const swept = this.pendingRowSweep && this.sweepClosedRows()
    this.pendingRowSweep = false
    if (applied.dirty || swept) {
      this.persist()
      this.scheduleDeadline()
    }
    if (applied.changed.length > 0 || swept) {
      this.kick()
    }
  }

  private noteStoreUnavailable(reason: string): void {
    const now = this.now()
    this.storeUnreadableSince ??= now
    const line = `signal store unavailable (${reason}); keeping the last rows read`
    if (reason !== 'busy' && now - this.lastStoreWarnAt >= OUTAGE_REWARN_MS) {
      this.lastStoreWarnAt = now
      this.log.warn(line)
    } else {
      this.log.debug(line)
    }
    this.updateFault()
  }

  private noteStoreAvailable(): void {
    if (this.storeUnreadableSince === null) {
      return
    }
    if (this.lastStoreWarnAt > 0) {
      this.log.info('signal store readable again')
    }
    this.storeUnreadableSince = null
    this.lastStoreWarnAt = 0
    this.updateFault()
  }

  // --- Startup housekeeping ------------------------------------------------------------

  private warnAboutKeyChange(orphaned: string[]): void {
    if (orphaned.length === 0) {
      return
    }
    const names = orphaned.map((key) => forLog(this.labelFor(key))).join(', ')
    this.log.warn(
      `the integration key changed while ${orphaned.length} alert(s) were open: ${names}. `
      + 'PagerDuty ignores a resolve sent on a different key, so resolve these in PagerDuty by hand. '
      + 'Anything still active is being sent on the new key',
    )
  }

  /**
   * After a corrupt state file, mark every alert that is desired closed as
   * possibly open, so the reconciler sends it a resolve. A resolve with no
   * open alert is dropped by PagerDuty with a `202`, so this is safe.
   */
  private sweepClosedAlerts(): void {
    const state = this.requireState()
    const desired = computeDesired(this.config, state)
    let count = 0
    for (const alert of this.config.alerts) {
      const target = desired.get(alertTargetKey(alert.id))
      if (target !== undefined && !target.open && state.delivered[target.key] === undefined) {
        state.delivered[target.key] = { dedupKey: target.dedupKey, severity: 'info', openedAt: this.now() }
        count += 1
      }
    }
    if (count > 0) {
      this.log.warn(`sending resolve for ${count} alert(s) the lost state file may have left open`)
    }
  }

  /** The same sweep for signals, once the first read says which exist. */
  private sweepClosedRows(): boolean {
    const state = this.requireState()
    const desired = computeDesired(this.config, state)
    let swept = false
    for (const target of desired.values()) {
      if (target.key.startsWith('signal:') && !target.open && state.delivered[target.key] === undefined) {
        state.delivered[target.key] = { dedupKey: target.dedupKey, severity: 'info', openedAt: this.now() }
        swept = true
      }
    }
    return swept
  }

  /** Drop switch and timer state for alerts removed from config. Their delivered records stay, so they are resolved. */
  private forgetRemovedAlerts(): void {
    const state = this.requireState()
    const kept = new Set([...this.alertsById.keys(), ...this.config.heldAlertIds])
    for (const key of Object.keys(state.levels)) {
      if (!kept.has(key.slice(0, key.lastIndexOf(':')))) {
        delete state.levels[key]
      }
    }
    for (const id of Object.keys(state.alerts)) {
      if (!kept.has(id)) {
        delete state.alerts[id]
      }
    }
  }

  private labelFor(targetKey: string): string {
    const alert = this.alertsById.get(targetKey.replace(/^alert:/, ''))
    return alert?.name ?? targetKey.replace(/^(?:alert|signal):/, '')
  }

  private persist(): void {
    void this.store.save(this.requireState())
  }

  private requireState(): PersistedState {
    if (this.state === undefined) {
      throw new Error('controller used before start()')
    }
    return this.state
  }
}

function levelName(alert: ResolvedAlert, severity: Severity): string {
  return alert.levels.find((level) => level.severity === severity)?.name ?? alert.name
}
