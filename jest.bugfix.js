/**
 * Jest configuration for bugfix spec tests.
 * Used to run projects-bug-condition.spec.ts and other bugfix-related tests.
 *
 * Differences from jest.config.js:
 * - Maps @prisma/client to the actual node_modules package (not src/prisma)
 * - Maps @octokit/* to a stub to avoid ESM parse errors from octokit packages
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // @prisma/client and all its sub-paths must resolve to node_modules, NOT src/prisma
    '^@prisma/client(.*)$': '<rootDir>/../node_modules/@prisma/client$1',
    // Stub out ESM-only octokit packages that can't be parsed by Jest/CJS
    '^@octokit/(.*)$': '<rootDir>/../__mocks__/octokit.js',
    '^universal-github-app-jwt(.*)$': '<rootDir>/../__mocks__/octokit.js',
    // Stub out ESM-only uuid package
    '^uuid$': '<rootDir>/../__mocks__/uuid.js',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@ai/(.*)$': '<rootDir>/ai/$1',
    '^@sandbox/(.*)$': '<rootDir>/sandbox/$1',
    '^@queue/(.*)$': '<rootDir>/queue/$1',
    '^@prisma/(.*)$': '<rootDir>/prisma/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/../tsconfig.json',
    },
  },
};
