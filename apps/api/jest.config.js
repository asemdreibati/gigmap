/**
 * Unit tests: pure logic, no database. Co-located with the code as
 * `*.spec.ts`. The end-to-end suite has its own config in `test/`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
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
};
