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
/** A completed HTTP response, with the body still unparsed. */
export interface HttpResponse {
    status: number;
    body: string;
    headers: Readonly<Record<string, string | string[] | undefined>>;
}
/** Per-request timing and size limits. */
export interface JsonRequestOptions {
    /** Deadline for establishing the TCP and TLS connection. */
    connectTimeoutMs: number;
    /** Deadline for the whole exchange. */
    totalTimeoutMs: number;
    /** Largest response body accepted, in bytes. */
    maxBytes: number;
    /** Cancels the request, so a shutdown need not wait out a deadline. */
    signal?: AbortSignal;
}
/** Performs one JSON POST. Injectable so tests never open a socket. */
export type JsonPost = (url: string, body: unknown, options: JsonRequestOptions) => Promise<HttpResponse>;
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
export declare const postJson: JsonPost;
