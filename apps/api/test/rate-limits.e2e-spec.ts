import type { ApiError } from '@gigmap/shared';

import { RATE_LIMITS } from '../src/config/rate-limits';
import {
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Rate limits', () => {
  let ctx: TestContext;
  let worker: Actor;
  let jobId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    worker = await signUp(ctx, 'worker');
    jobId = (await postJob(ctx, await signUp(ctx, 'employer'))).id;
  });

  afterAll(() => ctx.close());

  const report = (actor: Actor) =>
    ctx
      .as(actor)
      .post('/v1/reports')
      .send({ targetType: 'job', targetId: jobId, reason: 'Looks like a scam to me' });

  it('caps reports per user, with a Retry-After hint', async () => {
    for (let i = 0; i < RATE_LIMITS.reports.limit; i++) {
      await report(worker).expect(201);
    }

    const blocked = await report(worker).expect(429);

    expect((blocked.body as ApiError).message).toMatch(/too many requests/i);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('counts each user separately', async () => {
    for (let i = 0; i < RATE_LIMITS.reports.limit; i++) {
      await report(worker).expect(201);
    }

    await report(await signUp(ctx, 'worker')).expect(201);
  });

  it('never throttles the health checks', async () => {
    for (let i = 0; i < RATE_LIMITS.default.limit + 5; i++) {
      await ctx.anonymous().get('/health/live').expect(200);
    }
  });
});

/** Requires TEST_REDIS_URL; CI provides it. See ADR 0014. */
const withRedis = process.env['TEST_REDIS_URL'] ? describe : describe.skip;

withRedis('Rate limits across instances', () => {
  let a: TestContext;
  let b: TestContext;
  let jobId: string;

  beforeAll(async () => {
    const redisUrl = process.env['TEST_REDIS_URL']!;
    [a, b] = await Promise.all([createTestApp({ redisUrl }), createTestApp({ redisUrl })]);
  });

  beforeEach(async () => {
    await resetDatabase(a.prisma);
    jobId = (await postJob(a, await signUp(a, 'employer'))).id;
  });

  afterAll(() => Promise.all([a.close(), b.close()]));

  const report = (ctx: TestContext, actor: Actor) =>
    ctx
      .as(actor)
      .post('/v1/reports')
      .send({ targetType: 'job', targetId: jobId, reason: 'Looks like a scam to me' });

  it('shares one budget per user between instances', async () => {
    const worker = await signUp(a, 'worker');
    const half = RATE_LIMITS.reports.limit / 2;

    for (let i = 0; i < half; i++) {
      await report(a, worker).expect(201);
      await report(b, worker).expect(201);
    }

    // Each instance has seen only half the limit, but the user has spent it all.
    await report(a, worker).expect(429);
    await report(b, worker).expect(429);
  });
});

describe('Rate limits when Redis is down', () => {
  let ctx: TestContext;
  let jobId: string;

  beforeAll(async () => {
    // Nothing listens on port 1.
    ctx = await createTestApp({ redisUrl: 'redis://127.0.0.1:1' });
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    jobId = (await postJob(ctx, await signUp(ctx, 'employer'))).id;
  });

  afterAll(() => ctx.close());

  it('keeps serving and falls back to per-instance limits', async () => {
    const worker = await signUp(ctx, 'worker');
    const report = () =>
      ctx
        .as(worker)
        .post('/v1/reports')
        .send({ targetType: 'job', targetId: jobId, reason: 'Looks like a scam to me' });

    for (let i = 0; i < RATE_LIMITS.reports.limit; i++) {
      await report().expect(201);
    }
    await report().expect(429);
  });
});
