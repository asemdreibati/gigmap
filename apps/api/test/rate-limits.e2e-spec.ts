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

  it('never throttles the health check', async () => {
    for (let i = 0; i < RATE_LIMITS.default.limit + 5; i++) {
      await ctx.anonymous().get('/health').expect(200);
    }
  });
});
