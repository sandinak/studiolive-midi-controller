// Integration test config — uses real modules (no mocks)
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/integration/**/*.test.ts'],
  moduleNameMapper: {
    // Only mock easymidi (no hardware MIDI ports in CI)
    '^easymidi$': '<rootDir>/tests/__mocks__/easymidi.ts',
    // Do NOT mock presonus-studiolive-api — use the real module
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: false,
    }],
  },
};
