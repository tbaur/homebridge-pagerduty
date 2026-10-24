/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * The plugin version is published as FirmwareRevision and is part of every
 * rejection hash, so an unreadable manifest must degrade, not throw.
 */

import { fakeLogger } from '../helpers/hap'

type SettingsModule = typeof import('../../src/settings')

/** Run `use` against a fresh copy of settings, with an optional stand-in manifest. */
function withSettings(manifest: (() => unknown) | undefined, use: (settings: SettingsModule) => void): void {
  jest.isolateModules(() => {
    if (manifest !== undefined) {
      jest.doMock('../../package.json', manifest)
    }
    use(require('../../src/settings') as SettingsModule)
  })
  jest.dontMock('../../package.json')
}

describe('readPluginVersion', () => {
  it('reads the version from package.json, once', () => {
    const manifest = require('../../package.json') as { version: string }

    withSettings(undefined, (settings) => {
      expect(settings.readPluginVersion()).toBe(manifest.version)
      expect(settings.readPluginVersion()).toBe(manifest.version)
    })
  })

  it('falls back when the manifest has no version', () => {
    withSettings(() => ({}), (settings) => {
      expect(settings.readPluginVersion()).toBe('0.0.0')
    })
  })

  it('falls back, and says so at debug, when the manifest cannot be read', () => {
    const log = fakeLogger()

    withSettings(() => {
      throw new Error('gone')
    }, (settings) => {
      expect(settings.readPluginVersion(log)).toBe('0.0.0')
    })

    expect(log.lines('debug')[0]).toContain('could not read plugin version')
  })
})

describe('endpoints', () => {
  it('are PagerDuty\'s own hosts over https', () => {
    withSettings(undefined, ({ EVENTS_URLS }) => {
      expect(EVENTS_URLS).toEqual({
        us: 'https://events.pagerduty.com/v2/enqueue',
        eu: 'https://events.eu.pagerduty.com/v2/enqueue',
      })
    })
  })
})
