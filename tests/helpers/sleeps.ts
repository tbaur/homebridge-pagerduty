/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Backoff waits that a test releases by hand.
 *
 * The sender's delays are minutes long. Recording each requested delay and
 * releasing it explicitly lets a test assert both the delay and what happens
 * after it, without fake timers fighting the promise queue.
 */

import type { InterruptibleSleep } from '../../src/utils/timing'

/** Every requested wait, in order, each releasable. */
export class ManualSleeps {
  readonly delays: number[] = []
  private readonly pending: (() => void)[] = []

  /** The function to hand the sender or controller. */
  readonly sleep = (ms: number): InterruptibleSleep => {
    this.delays.push(ms)
    let release = (): void => {}
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    this.pending.push(release)
    return { promise, interrupt: release }
  }

  /** Number of waits not yet released. */
  get waiting(): number {
    return this.pending.length
  }

  /** Release the oldest wait. */
  releaseNext(): void {
    const release = this.pending.shift()
    if (release === undefined) {
      throw new Error('no backoff is waiting')
    }
    release()
  }
}
