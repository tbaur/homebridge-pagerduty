/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Every request carries the routing key. Its limits are driven against a real
 * loopback server: the response cap, the deadlines and the refusal to follow
 * a redirect are properties of a socket and a stream, and a hand-written
 * emitter would only confirm that the emitter behaves.
 */

import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'

import { postJson, type JsonRequestOptions } from '../../../src/delivery/http'
import { ConnectionError, ProtocolError } from '../../../src/utils/errors'
import { FAKE_ROUTING_KEY } from '../../helpers/secrets'

interface SeenRequest {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  body: string
}

type Answer = (request: http.IncomingMessage, response: http.ServerResponse) => void

const FAKE_TIMERS: Parameters<typeof jest.useFakeTimers>[0] = {
  doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'Date', 'hrtime', 'performance'],
}

function requestOptions(overrides: Partial<JsonRequestOptions> = {}): JsonRequestOptions {
  return { connectTimeoutMs: 5_000, totalTimeoutMs: 5_000, maxBytes: 64 * 1024, ...overrides }
}

let server: http.Server
let origin = ''
let deadPort = 0
let seen: SeenRequest[] = []
let answer: Answer = () => undefined

/**
 * Send the request over plain TCP on loopback. Only the TLS handshake is
 * swapped out; that an `https:` URL was asked for is asserted separately.
 */
function dialLoopback() {
  return jest.spyOn(https, 'request').mockImplementation((
    url: string | URL,
    options: https.RequestOptions,
    handleResponse?: (response: http.IncomingMessage) => void,
  ) => {
    const target = new URL(String(url))
    target.protocol = 'http:'
    return http.request(target, options, handleResponse)
  })
}

function reply(code: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): Answer {
  return (_request, response) => {
    response.writeHead(code, { 'content-type': 'application/json', ...headers })
    response.end(JSON.stringify(body))
  }
}

function arrival(): Promise<void> {
  return new Promise<void>((resolve) => {
    answer = () => resolve()
  })
}

/** Every message in a cause chain, duck-typed across realms. */
function chainOf(error: unknown): string {
  const parts: string[] = []
  const visited = new Set<unknown>()
  let current: unknown = error
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)
    const { message, cause } = current as { message?: unknown; cause?: unknown }
    if (typeof message === 'string') {
      parts.push(message)
    }
    current = cause
  }
  return parts.join(' | ')
}

function fakeRequest(): EventEmitter & { destroy: jest.Mock; end: jest.Mock } {
  const fake = new EventEmitter() as EventEmitter & { destroy: jest.Mock; end: jest.Mock }
  fake.destroy = jest.fn()
  fake.end = jest.fn()
  return fake
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    request.on('error', () => undefined)
    response.on('error', () => undefined)
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      seen.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
      answer(request, response)
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`

  const closed = http.createServer()
  await new Promise<void>((resolve) => {
    closed.listen(0, '127.0.0.1', resolve)
  })
  deadPort = (closed.address() as AddressInfo).port
  await new Promise<void>((resolve) => {
    closed.close(() => resolve())
  })
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

beforeEach(() => {
  seen = []
  answer = reply(202, { status: 'success', message: 'Event processed', dedup_key: 'homebridge/leak' })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('a normal exchange', () => {
  it('posts the event as JSON over https and returns status, body and headers', async () => {
    const requested = dialLoopback()
    answer = reply(429, { status: 'throttle' }, { 'retry-after': '30' })

    const response = await postJson(`${origin}/v2/enqueue`, { routing_key: FAKE_ROUTING_KEY, event_action: 'trigger' }, requestOptions())

    expect(String(requested.mock.calls[0]![0]).startsWith('https://')).toBe(true)
    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBe('30')
    expect(seen[0]).toEqual(expect.objectContaining({ method: 'POST', path: '/v2/enqueue' }))
    expect(seen[0]!.headers['content-type']).toBe('application/json')
    expect(JSON.parse(seen[0]!.body)).toEqual({ routing_key: FAKE_ROUTING_KEY, event_action: 'trigger' })
  })

  it('measures content-length in bytes', async () => {
    dialLoopback()

    await postJson(`${origin}/v2/enqueue`, { summary: 'Chaudière' }, requestOptions())

    expect(seen[0]!.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify({ summary: 'Chaudière' }))))
  })

  it('posts an empty object for an undefined body', async () => {
    dialLoopback()

    await postJson(`${origin}/v2/enqueue`, undefined, requestOptions())

    expect(seen[0]!.body).toBe('{}')
  })

  it('does not follow a redirect, so a spoofed endpoint cannot collect the key', async () => {
    dialLoopback()
    answer = (_request, response) => {
      response.writeHead(307, { location: '/collect' })
      response.end()
    }

    const response = await postJson(`${origin}/v2/enqueue`, { routing_key: FAKE_ROUTING_KEY }, requestOptions())

    expect(response.status).toBe(307)
    expect(seen).toHaveLength(1)
  })

  it('leaves no timer behind once the answer has arrived', async () => {
    jest.useFakeTimers(FAKE_TIMERS)
    dialLoopback()

    await postJson(`${origin}/v2/enqueue`, {}, requestOptions())

    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('limits', () => {
  it('stops reading a response that grows past the cap', async () => {
    dialLoopback()
    answer = (_request, response) => {
      response.writeHead(200)
      response.end('x'.repeat(4_096))
    }

    const failure = await postJson(`${origin}/v2/enqueue`, {}, requestOptions({ maxBytes: 64 })).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ProtocolError)
    expect((failure as Error).message).toBe('response exceeds 64 bytes')
  })

  it('gives up on a host that never accepts the connection', async () => {
    jest.useFakeTimers(FAKE_TIMERS)
    const fake = fakeRequest()
    jest.spyOn(https, 'request').mockImplementation(() => {
      queueMicrotask(() => {
        fake.emit('socket', { connecting: true, once() { /* never connects */ }, setNoDelay() { /* unused */ } })
      })
      return fake as unknown as http.ClientRequest
    })

    const pending = postJson('https://events.example.com/v2/enqueue', {}, requestOptions({ connectTimeoutMs: 80, totalTimeoutMs: 30_000 }))
    await Promise.resolve()
    jest.advanceTimersByTime(80)
    const failure = await pending.catch((error: unknown) => error)

    expect((failure as Error).message).toBe('connect timed out after 80ms')
    expect(fake.destroy).toHaveBeenCalled()
  })

  it('waits for the TLS handshake, not just TCP, before clearing the connect clock', async () => {
    jest.useFakeTimers(FAKE_TIMERS)
    const fake = fakeRequest()
    const socket = Object.assign(new EventEmitter(), { connecting: true, encrypted: true, setNoDelay: () => undefined })
    jest.spyOn(https, 'request').mockImplementation(() => {
      queueMicrotask(() => {
        fake.emit('socket', socket)
        socket.emit('connect')
      })
      return fake as unknown as http.ClientRequest
    })

    const pending = postJson('https://events.example.com/v2/enqueue', {}, requestOptions({ connectTimeoutMs: 80, totalTimeoutMs: 30_000 }))
    await Promise.resolve()
    jest.advanceTimersByTime(80)

    expect((await pending.catch((error: unknown) => error) as Error).message).toBe('connect timed out after 80ms')
  })

  it('clears the connect clock at once for a socket that is already connected', async () => {
    jest.useFakeTimers(FAKE_TIMERS)
    const fake = fakeRequest()
    const setNoDelay = jest.fn()
    jest.spyOn(https, 'request').mockImplementation(() => {
      queueMicrotask(() => {
        fake.emit('socket', { connecting: false, setNoDelay })
      })
      return fake as unknown as http.ClientRequest
    })

    const pending = postJson('https://events.example.com/v2/enqueue', {}, requestOptions({ connectTimeoutMs: 80, totalTimeoutMs: 1_000 }))
    await Promise.resolve()
    jest.advanceTimersByTime(80)
    expect(setNoDelay).toHaveBeenCalled()
    jest.advanceTimersByTime(1_000)

    expect((await pending.catch((error: unknown) => error) as Error).message).toBe('request timed out after 1000ms')
  })

  it('gives up on an endpoint that takes the request and says nothing', async () => {
    jest.useFakeTimers(FAKE_TIMERS)
    dialLoopback()
    const arrived = arrival()

    const pending = postJson(`${origin}/v2/enqueue`, {}, requestOptions({ totalTimeoutMs: 30_000 }))
    await arrived
    jest.advanceTimersByTime(30_000)

    expect((await pending.catch((error: unknown) => error) as Error).message).toBe('request timed out after 30000ms')
  })
})

describe('cancellation', () => {
  it('refuses before opening a socket when already aborted', async () => {
    const requested = dialLoopback()

    const failure = await postJson(`${origin}/v2/enqueue`, {}, requestOptions({ signal: AbortSignal.abort() })).catch((error: unknown) => error)

    expect((failure as Error).message).toBe('request aborted before it started')
    expect(requested).not.toHaveBeenCalled()
  })

  it('abandons a request in flight when the signal fires', async () => {
    dialLoopback()
    const controller = new AbortController()
    const arrived = arrival()

    const pending = postJson(`${origin}/v2/enqueue`, {}, requestOptions({ signal: controller.signal }))
    await arrived
    controller.abort()

    expect((await pending.catch((error: unknown) => error) as Error).message).toBe('request aborted')
  })

  it('lets go of the abort signal once the answer has arrived', async () => {
    dialLoopback()
    const controller = new AbortController()
    const released = jest.spyOn(controller.signal, 'removeEventListener')

    await postJson(`${origin}/v2/enqueue`, {}, requestOptions({ signal: controller.signal }))

    expect(released).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})

describe('when the connection fails', () => {
  it('reports a hang-up mid-body as a connection failure', async () => {
    dialLoopback()
    answer = (_request, response) => {
      response.writeHead(200, { 'content-length': '64' })
      response.write('{"status":"su')
      response.socket?.destroy()
    }

    const failure = await postJson(`${origin}/v2/enqueue`, {}, requestOptions()).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConnectionError)
  })

  it('keeps the URL and the body out of everything it raises', async () => {
    dialLoopback()
    const body = { routing_key: FAKE_ROUTING_KEY }
    const failures: unknown[] = []

    failures.push(await postJson(`https://127.0.0.1:${deadPort}/v2/enqueue`, body, requestOptions()).catch((error: unknown) => error))
    answer = (_request, response) => {
      response.writeHead(200)
      response.end('y'.repeat(2_048))
    }
    failures.push(await postJson(`${origin}/v2/enqueue`, body, requestOptions({ maxBytes: 32 })).catch((error: unknown) => error))

    expect((failures[0] as Error).message).toBe('request failed')
    expect(chainOf(failures[0])).toContain('ECONNREFUSED')
    for (const failure of failures) {
      expect(chainOf(failure)).not.toContain(FAKE_ROUTING_KEY)
      expect(chainOf(failure)).not.toContain('/v2/enqueue')
    }
  })
})
