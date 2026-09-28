import type { ApiError, NearbyJob } from '@gigmap/shared';

import {
  ZURICH,
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Jobs', () => {
  let ctx: TestContext;
  let employer: Actor;
  let worker: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.push.reset();
    employer = await signUp(ctx, 'employer');
    worker = await signUp(ctx, 'worker');
  });

  afterAll(() => ctx.close());

  const nearby = async (query: string): Promise<NearbyJob[]> => {
    const response = await ctx.as(worker).get(`/v1/jobs/nearby?${query}`).expect(200);
    return response.body as NearbyJob[];
  };

  describe('GET /v1/jobs/nearby', () => {
    it('returns jobs inside the radius, nearest first, with distance', async () => {
      // ~1.1 km and ~4.4 km north of the search point; Bern is ~95 km away.
      const near = await postJob(ctx, employer, { latitude: ZURICH.latitude + 0.01 });
      const further = await postJob(ctx, employer, { latitude: ZURICH.latitude + 0.04 });
      await postJob(ctx, employer, { latitude: 46.948, longitude: 7.4474 });

      const jobs = await nearby(`lat=${ZURICH.latitude}&lng=${ZURICH.longitude}&radiusKm=10`);

      expect(jobs.map((job) => job.id)).toEqual([near.id, further.id]);
      expect(jobs[0]!.distanceKm).toBeCloseTo(1.11, 1);
      expect(jobs[0]!.employer).not.toHaveProperty('email');
    });

    it('filters by category', async () => {
      await postJob(ctx, employer, { category: 'hospitality' });
      const cleaning = await postJob(ctx, employer, { category: 'cleaning' });

      const jobs = await nearby(`lat=${ZURICH.latitude}&lng=${ZURICH.longitude}&category=cleaning`);

      expect(jobs.map((job) => job.id)).toEqual([cleaning.id]);
    });

    it('validates the query string', async () => {
      const response = await ctx
        .as(worker)
        .get('/v1/jobs/nearby?lat=abc&lng=8.5&radiusKm=500')
        .expect(422);

      const { errors } = response.body as ApiError;
      expect(Object.keys(errors ?? {}).sort()).toEqual(['lat', 'radiusKm']);
    });
  });

  describe('POST /v1/jobs', () => {
    it('rejects a start time in the past', async () => {
      await ctx
        .as(employer)
        .post('/v1/jobs')
        .send({
          title: 'Too late',
          description: 'This one already started',
          category: 'events',
          payAmount: 100,
          payType: 'fixed',
          ...ZURICH,
          address: 'Zürich',
          startTime: '2020-01-01T10:00:00.000Z',
        })
        .expect(422);
    });

    it('keeps the posting up for at least a week', async () => {
      const job = await postJob(ctx, employer);
      const days = (Date.parse(job.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);

      expect(days).toBeCloseTo(7, 1);
    });

    it("forbids editing another employer's job", async () => {
      const job = await postJob(ctx, employer);
      const other = await signUp(ctx, 'employer');

      await ctx.as(other).patch(`/v1/jobs/${job.id}`).send({ title: 'Mine now' }).expect(403);
    });
  });
});
