/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opt-in diagnostics collector.
 *
 * It reads only in-memory state through `readGauges`; it never touches the
 * network and never sees the routing key.
 */
import type { DeliveryGauges, DiagnosticsSnapshot, PagerDutyPlatformConfig } from '../types';
/** Health classification result. */
export interface HealthRollup {
    health: 'healthy' | 'degraded';
    reasons: string[];
}
interface CollectorOptions {
    pluginVersion: string;
    config: PagerDutyPlatformConfig;
    now?: () => number;
}
/** Accumulates diagnostics counters and renders heartbeat and snapshot reports. */
export declare class DiagnosticsCollector {
    private readonly now;
    private readonly startedAtMs;
    private readonly pluginVersion;
    private readonly configEcho;
    private requests;
    private errors;
    private readonly latencies;
    private marker;
    constructor(options: CollectorOptions);
    /** One Events API request finished. */
    apiRequest(durationMs: number, ok: boolean): void;
    /** Nearest-rank percentile (0..100) over the recent-latency window. */
    percentile(p: number): number;
    /** Degraded while pages are not going out, PagerDuty is unreachable, or the store is unreadable. */
    rollup(gauges: DeliveryGauges): HealthRollup;
    /** Per-interval request deltas plus absolute gauges. */
    buildHeartbeat(gauges: DeliveryGauges): DiagnosticsSnapshot;
    /** Cumulative totals plus the redacted config echo. */
    snapshot(msg: string, gauges: DeliveryGauges): DiagnosticsSnapshot;
    private buildReport;
}
export {};
