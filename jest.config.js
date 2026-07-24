module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // `src` must be a root as well as `tests`: Jest only discovers untested
  // files for coverage inside its roots, so with `tests` alone the files with
  // no tests at all were silently omitted from the report rather than counted
  // as 0%. That inflated the headline number from ~32% to ~71%.
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  // Soak tests live under tests/soak and run via their own config
  // (`npm run test:soak`) — they're long by design and must not run in the
  // default unit suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/soak/'],
  moduleNameMapper: {
    '^easymidi$': '<rootDir>/tests/__mocks__/easymidi.ts',
    '^presonus-studiolive-api(/.*)?$': '<rootDir>/tests/__mocks__/presonus-studiolive-api.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    // Type-only module — no runtime statements to cover.
    '!src/shared/types.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  // Ratchet, set just under the measured figures (41.3 / 43.3 / 40.9 / 41.6).
  // Raise these as coverage improves; never lower them to make a failing run
  // pass. index.ts, still at 0%, is the bulk of what is left uncovered.
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 42,
      functions: 39,
      lines: 40,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      // Skip type-checking during tests — use `make typecheck` for that
      diagnostics: false,
    }],
  },
};
