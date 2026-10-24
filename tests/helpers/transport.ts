/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview A stand-in for the Events API.
 *
 * Records every body it is handed and answers from a script. By default it
 * answers `202`, as PagerDuty does. A test can queue answers, throw, or hold a
 * request open to see what happens while one is in flight.
 */

import type { HttpResponse, JsonPost } from '../../src/delivery/http'
import type { ResolveEvent, TriggerEvent } from '../../src/delivery/events'

type Answer = HttpResponse | Error | (() => Promise<HttpResponse>)

/** A scripted Events API. */
export class FakeEventsApi {
  readonly urls: string[] = []
  readonly bodies: (TriggerEvent | ResolveEvent)[] = []
  private readonly script: Answer[] = []
  private fallback: Answer = accepted()

  /** The function to hand the controller. */
  readonly post: JsonPost = (url, body) => {
    this.urls.push(url)
    this.bodies.push(body as TriggerEvent | ResolveEvent)
    const answer = this.script.shift() ?? this.fallback
    if (answer instanceof Error) {
      return Promise.reject(answer)
    }
    if (typeof answer === 'function') {
      return answer()
    }
    return Promise.resolve(answer)
  }

  /** Answer the next requests with these, in order. */
  queue(...answers: Answer[]): this {
    this.script.push(...answers)
    return this
  }

  /** Answer every unscripted request with this. */
  always(answer: Answer): this {
    this.fallback = answer
    return this
  }

  /** `event_action` and `dedup_key` of every request, for compact assertions. */
  get actions(): string[] {
    return this.bodies.map((body) => (body.event_action === 'trigger'
      ? `trigger ${body.dedup_key} ${body.payload.severity}`
      : `resolve ${body.dedup_key}`))
  }
}

/** PagerDuty's normal answer. */
export function accepted(): HttpResponse {
  return { status: 202, body: '{"status":"success","message":"Event processed","dedup_key":"x"}', headers: {} }
}

/** Any status, with an optional body and headers. */
export function status(code: number, body = '', headers: Record<string, string> = {}): HttpResponse {
  return { status: code, body, headers }
}

/** Let every pending promise callback run. */
export async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve()
  }
}
