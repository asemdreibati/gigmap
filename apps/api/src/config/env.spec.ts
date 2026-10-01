import { validateEnv } from './env';

const required = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SUPABASE_URL: 'https://abcd.supabase.co',
};

describe('validateEnv', () => {
  it('applies defaults, logging JSON in production and text elsewhere', () => {
    expect(validateEnv({ ...required })).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3333,
      LOG_LEVEL: 'log',
      LOG_FORMAT: 'text',
      SHUTDOWN_DRAIN_MS: 0,
      TRUST_PROXY_HOPS: 0,
    });
    expect(validateEnv({ ...required, NODE_ENV: 'production' }).LOG_FORMAT).toBe('json');
    expect(
      validateEnv({ ...required, NODE_ENV: 'production', LOG_FORMAT: 'text' }).LOG_FORMAT,
    ).toBe('text');
  });

  it('lists every problem at once', () => {
    let message = '';
    try {
      validateEnv({ SUPABASE_URL: 'not a url', LOG_LEVEL: 'loud' });
    } catch (error) {
      message = (error as Error).message;
    }

    for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'LOG_LEVEL']) {
      expect(message).toContain(key);
    }
  });
});
