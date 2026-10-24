/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Events API v2 request bodies, and reading PagerDuty's answer.
 *
 * Pure. A body built here carries the routing key, so it is handed to the HTTP
 * layer and never to a logger. See docs/EVENTS-API.md for each field.
 */
import type { Action } from '../state/reconcile';
import type { Severity } from '../types';
/** A `trigger` body. */
export interface TriggerEvent {
    routing_key: string;
    event_action: 'trigger';
    dedup_key: string;
    client: string;
    payload: {
        summary: string;
        source: string;
        severity: Severity;
        timestamp: string;
        component: string;
        group: string;
        custom_details: Record<string, string>;
    };
}
/** A `resolve` body. */
export interface ResolveEvent {
    routing_key: string;
    event_action: 'resolve';
    dedup_key: string;
}
/** Build the body for one action. */
export declare function buildEvent(action: Action, input: {
    routingKey: string;
    source: string;
}): TriggerEvent | ResolveEvent;
/** How the sender treats a response status. */
export type StatusClass = 'delivered' | 'rejected' | 'rateLimited' | 'retry';
/**
 * Classify a status.
 *
 * `2xx` is delivered (anything but `202` also warns). `408` and `429` wait
 * minutes. Any other `4xx` is PagerDuty refusing the event, which no retry
 * will change. `3xx` (never followed), `5xx` and anything odd are retried.
 */
export declare function classifyStatus(status: number): StatusClass;
/**
 * PagerDuty's explanation from a `4xx` body, safe to log.
 *
 * The body is external text and may echo the request, so it goes through the
 * same redaction and length cap as an error message.
 */
export declare function rejectionReason(status: number, body: string): string;
