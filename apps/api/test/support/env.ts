/**
 * Environment for the e2e suite. Runs before each test file, ahead of any
 * import of the app, so `validateEnv` and PrismaClient see these values
 * rather than whatever is in the developer's `.env`.
 */

const databaseUrl = process.env['TEST_DATABASE_URL'];

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. The e2e suite truncates every table, so it only ' +
      'runs against a database named explicitly for it. See docs/testing.md.',
  );
}

export const TEST_SUPABASE_URL = 'https://gigmap-test.supabase.co';
export const TEST_JWT_SECRET = 'gigmap-e2e-jwt-secret';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  SUPABASE_URL: TEST_SUPABASE_URL,
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  EXPO_ACCESS_TOKEN: '',
  RESEND_API_KEY: '',
});
