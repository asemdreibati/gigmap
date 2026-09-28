import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Brings the test database up to the latest migration once per run. */
export default function globalSetup(): void {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (!databaseUrl) {
    // env.ts raises the descriptive error; nothing to migrate here.
    return;
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    stdio: 'inherit',
  });
}
