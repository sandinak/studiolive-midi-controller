module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^easymidi$': '<rootDir>/tests/__mocks__/easymidi.ts',
    '^presonus-studiolive-api(/.*)?$': '<rootDir>/tests/__mocks__/presonus-studiolive-api.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      // Skip type-checking during tests — use `make typecheck` for that
      diagnostics: false,
    }],
  },
};
