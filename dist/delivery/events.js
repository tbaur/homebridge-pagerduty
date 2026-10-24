"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEvent = buildEvent;
exports.classifyStatus = classifyStatus;
exports.rejectionReason = rejectionReason;
const settings_1 = require("../settings");
const errors_1 = require("../utils/errors");
/** Build the body for one action. */
function buildEvent(action, input) {
    if (action.kind === 'resolve') {
        return { routing_key: input.routingKey, event_action: 'resolve', dedup_key: action.dedupKey };
    }
    return {
        routing_key: input.routingKey,
        event_action: 'trigger',
        dedup_key: action.dedupKey,
        client: settings_1.EVENT_CLIENT,
        payload: {
            summary: action.summary,
            source: input.source,
            severity: action.severity,
            // When the condition changed, not when the request was sent, so a
            // trigger delivered after an outage still shows the real start time.
            timestamp: new Date(action.timestamp > 0 ? action.timestamp : Date.now()).toISOString(),
            component: action.details.component,
            group: action.details.group,
            custom_details: action.details.custom,
        },
    };
}
/**
 * Classify a status.
 *
 * `2xx` is delivered (anything but `202` also warns). `408` and `429` wait
 * minutes. Any other `4xx` is PagerDuty refusing the event, which no retry
 * will change. `3xx` (never followed), `5xx` and anything odd are retried.
 */
function classifyStatus(status) {
    if (status >= 200 && status < 300) {
        return 'delivered';
    }
    if (status === 408 || status === 429) {
        return 'rateLimited';
    }
    if (status >= 400 && status < 500) {
        return 'rejected';
    }
    return 'retry';
}
/**
 * PagerDuty's explanation from a `4xx` body, safe to log.
 *
 * The body is external text and may echo the request, so it goes through the
 * same redaction and length cap as an error message.
 */
function rejectionReason(status, body) {
    let detail = '';
    try {
        const parsed = JSON.parse(body);
        const errors = Array.isArray(parsed.errors) ? parsed.errors.map(String).join('; ') : '';
        const message = typeof parsed.message === 'string' ? parsed.message : '';
        detail = [message, errors].filter((part) => part.length > 0).join(': ');
    }
    catch {
        detail = body;
    }
    return (0, errors_1.describeError)(detail.length > 0 ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
}
