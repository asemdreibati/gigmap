import type { PendingRating } from '@gigmap/shared';

import {
  apply,
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Ratings', () => {
  let ctx: TestContext;
  let employer: Actor;
  let worker: Actor;
  let jobId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    employer = await signUp(ctx, 'employer');
    worker = await signUp(ctx, 'worker');

    const job = await postJob(ctx, employer);
    jobId = job.id;
    const applicationId = await apply(ctx, worker, jobId);
    await ctx
      .as(employer)
      .patch(`/v1/applications/${applicationId}`)
      .send({ status: 'accepted' })
      .expect(200);
  });

  afterAll(() => ctx.close());

  /** The API refuses past start times, so time-travel the row directly. */
  const startJobInThePast = () =>
    ctx.prisma.job.update({
      where: { id: jobId },
      data: { startTime: new Date(Date.now() - 60 * 60 * 1000) },
    });

  it('only opens once the job has started', async () => {
    await ctx
      .as(worker)
      .post('/v1/ratings')
      .send({ jobId, ratedId: employer.id, stars: 5 })
      .expect(400);
  });

  it('lets both sides rate each other once, and updates the average', async () => {
    await startJobInThePast();

    const pending = await ctx.as(worker).get('/v1/ratings/pending').expect(200);
    expect((pending.body as PendingRating[]).map((rating) => rating.ratedUser.id)).toEqual([
      employer.id,
    ]);

    await ctx
      .as(worker)
      .post('/v1/ratings')
      .send({ jobId, ratedId: employer.id, stars: 4 })
      .expect(201);
    await ctx
      .as(employer)
      .post('/v1/ratings')
      .send({ jobId, ratedId: worker.id, stars: 5 })
      .expect(201);
    await ctx
      .as(worker)
      .post('/v1/ratings')
      .send({ jobId, ratedId: employer.id, stars: 1 })
      .expect(409);

    const profile = await ctx.as(worker).get(`/v1/users/${employer.id}`).expect(200);
    expect(profile.body).toMatchObject({ avgRating: 4, ratingCount: 1 });
    expect((await ctx.as(worker).get('/v1/ratings/pending')).body).toEqual([]);
  });

  it('refuses ratings from users who were not part of the job', async () => {
    await startJobInThePast();
    const stranger = await signUp(ctx, 'worker');

    await ctx
      .as(stranger)
      .post('/v1/ratings')
      .send({ jobId, ratedId: employer.id, stars: 1 })
      .expect(403);
  });
});
