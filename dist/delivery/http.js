"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview JSON over HTTPS to the PagerDuty Events API.
 *
 * Built on `node:https` rather than `fetch` for three reasons.
 *
 * A response size cap, applied as bytes arrive.
 *
 * Separate connect and total deadlines. An unreachable host should fail in
 * seconds, not hold the sender for the whole request budget.
 *
 * Control over what is logged. The request body carries the routing key.
 * `fetch` errors quote the URL, and a debug logger wrapped round it would
 * eventually quote a body. Nothing from this layer quotes either.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postJson = void 0;
const node_https_1 = __importDefault(require("node:https"));
const errors_1 = require("../utils/errors");
/**
 * POST a JSON body and read the response as text.
 *
 * Rejects with {@link ConnectionError} for anything that prevented an answer
 * and {@link ProtocolError} when the answer was too large. A non-2xx status
 * is returned, not thrown: PagerDuty's `400` body explains what was wrong.
 *
 * Redirects are not followed. PagerDuty does not issue them, and following one
 * would let a spoofed endpoint move a request carrying the routing key to a
 * host of its choosing.
 */
const postJson = (url, body, options) => {
    const { connectTimeoutMs, totalTimeoutMs, maxBytes, signal } = options;
    const payload = JSON.stringify(body ?? {});
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(new errors_1.ConnectionError('request aborted before it started'));
            return;
        }
        let settled = false;
        let onAbort;
        // Held in a container because `cleanup` closes over it before the timer
        // that fills it in can be created.
        const timers = {};
        const request = node_https_1.default.request(url, {
            method: 'POST',
            // A connection per request. Events are rare, and a pooled socket is one
            // more thing holding state across an outage.
            agent: false,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(payload)),
            },
        }, (response) => {
            const chunks = [];
            let received = 0;
            response.on('data', (chunk) => {
                received += chunk.length;
                if (received > maxBytes) {
                    fail(new errors_1.ProtocolError(`response exceeds ${maxBytes} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                finish({
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                    headers: response.headers,
                });
            });
            response.on('error', (error) => {
                fail(new errors_1.ConnectionError('response stream failed', { cause: error }));
            });
        });
        const cleanup = () => {
            if (timers.connect !== undefined) {
                clearTimeout(timers.connect);
            }
            if (timers.total !== undefined) {
                clearTimeout(timers.total);
            }
            if (onAbort !== undefined) {
                signal?.removeEventListener('abort', onAbort);
            }
        };
        const finish = (response) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(response);
        };
        const fail = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            request.destroy();
            reject(error);
        };
        // Our own timer, not `request.setTimeout`. Node defers that call until the
        // socket is already connected, so a host that blackholes the SYN would sit
        // on the total deadline instead of failing in seconds.
        timers.connect = setTimeout(() => {
            fail(new errors_1.ConnectionError(`connect timed out after ${connectTimeoutMs}ms`));
        }, connectTimeoutMs);
        request.on('socket', (socket) => {
            const onReady = () => {
                if (timers.connect !== undefined) {
                    clearTimeout(timers.connect);
                    timers.connect = undefined;
                }
                socket.setNoDelay(true);
            };
            if (socket.connecting) {
                // A TLSSocket has `encrypted`. Waiting on TCP `connect` would clear
                // the timer before the handshake finishes. A plain socket (the test
                // loopback under an `https:` URL) only emits `connect`.
                if ('encrypted' in socket) {
                    socket.once('secureConnect', onReady);
                }
                else {
                    socket.once('connect', onReady);
                }
            }
            else {
                onReady();
            }
        });
        request.on('error', (error) => {
            // Deliberately generic. Node puts the request URL into some socket
            // errors, and nothing from this layer quotes a URL.
            fail(new errors_1.ConnectionError('request failed', { cause: error }));
        });
        // Referenced on purpose, and always cleared in `cleanup`: a caller is
        // awaiting this request, so the process must not be free to exit under it.
        timers.total = setTimeout(() => {
            fail(new errors_1.ConnectionError(`request timed out after ${totalTimeoutMs}ms`));
        }, totalTimeoutMs);
        if (signal !== undefined) {
            onAbort = () => {
                fail(new errors_1.ConnectionError('request aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
        request.end(payload);
    });
};
exports.postJson = postJson;
