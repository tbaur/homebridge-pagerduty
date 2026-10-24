/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Jest configuration for sandboxed testing.
 * All tests run in isolation with stand-in transports; nothing reaches PagerDuty.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Mock lifecycle is handled here rather than in per-suite hooks.
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  // Barrels are listed individually: a blanket `!src/**/index.ts` would also
  // exclude `src/index.ts`, the plugin entry point.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/devices/index.ts',
    '!src/types/index.ts',
    '!src/utils/index.ts',
  ],

  testMatch: [
    '**/tests/unit/**/*.test.ts',
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  testTimeout: 10_000,
  verbose: true,
}
