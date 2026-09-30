/**
 * Integration tests (PRD 12.4): real Postgres (Testcontainers) with the committed Prisma migrations;
 * all external HTTP goes through the fake fetch. Skips cleanly when Docker is unavailable.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test-integration'],
  testRegex: '.*\\.integration\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@repo/(core-domain|connector-contracts|http-client|connector-aw-aiku|connector-prestashop9|connector-temu-eu|pim-catalog|pim-orders)$':
      '<rootDir>/../$1/src',
  },
  testEnvironment: 'node',
  // One shared Postgres container and tests truncate tables: never run files in parallel.
  maxWorkers: 1,
  testTimeout: 60000,
  globalSetup: '<rootDir>/test-integration/global-setup.ts',
  globalTeardown: '<rootDir>/test-integration/global-teardown.ts',
};
