import { randomUUID } from 'node:crypto';

import {
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Reports', () => {
  let ctx: TestContext;
  let employer: Actor;
  let worker: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    employer = await signUp(ctx, 'employer');
    worker = await signUp(ctx, 'worker');
  });

  afterAll(() => ctx.close());

  const report = (actor: Actor, targetType: 'job' | 'user', targetId: string) =>
    ctx
      .as(actor)
      .post('/v1/reports')
      .send({ targetType, targetId, reason: 'Asked me to pay upfront in cash' });

  it('files reports against other users and their jobs', async () => {
    const job = await postJob(ctx, employer);

    await report(worker, 'job', job.id).expect(201);
    await report(worker, 'user', employer.id).expect(201);

    expect(await ctx.prisma.report.count({ where: { reporterId: worker.id } })).toBe(2);
  });

  it('refuses reports against yourself or your own job', async () => {
    const job = await postJob(ctx, employer);

    await report(worker, 'user', worker.id).expect(400);
    await report(employer, 'job', job.id).expect(400);
  });

  it('refuses reports against things that do not exist', async () => {
    await report(worker, 'job', randomUUID()).expect(400);
  });
});
