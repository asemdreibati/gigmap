/**
 * End-to-end tests: the real Nest app against a real Postgres + PostGIS.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable database — every test
 * truncates all tables. See docs/testing.md.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.e2e-spec\\.ts$',
  // expo-server-sdk ships ESM only. Node runs it from our CommonJS build
  // (require(esm), Node >= 22.12), but Jest cannot, so it is transpiled.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
    '/node_modules/expo-server-sdk/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs' }, isolatedModules: true },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!expo-server-sdk/)'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  globalSetup: '<rootDir>/support/global-setup.ts',
  setupFiles: ['<rootDir>/support/env.ts'],
  // One database, so suites must not interleave.
  maxWorkers: 1,
  testTimeout: 30_000,
};
