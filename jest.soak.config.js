// Soak / leak / throughput test config.
//
// These tests drive the main-process managers through sustained churn and
// high-frequency event floods to catch the failure modes that only appear over
// a long live session: leaked timers/listeners, maps that never drain, and
// throughput regressions. They use the same mocks as the unit suite, so no
// hardware is required and they run in CI.
//
// Run with `npm run test:soak` — the script passes `--expose-gc` and
// `--runInBand` so heap measurements are taken in-process with real GC.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/soak'],
  testMatch: ['**/tests/soak/**/*.soak.test.ts'],
  moduleNameMapper: {
    '^easymidi$': '<rootDir>/tests/__mocks__/easymidi.ts',
    '^presonus-studiolive-api(/.*)?$': '<rootDir>/tests/__mocks__/presonus-studiolive-api.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
  },
  // Soak loops are long by design. The endurance test self-bounds via a
  // wall-clock deadline, so this is just an upper guard — it MUST exceed the
  // longest intended run or jest kills the test mid-soak (an in-test
  // jest.setTimeout() does not reliably extend an already-running test).
  // Default 10h; override with SOAK_JEST_TIMEOUT_MS for longer runs.
  testTimeout: parseInt(process.env.SOAK_JEST_TIMEOUT_MS || String(10 * 3600 * 1000), 10),
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: false,
    }],
  },
};
