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
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
