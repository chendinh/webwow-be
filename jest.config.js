/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
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
