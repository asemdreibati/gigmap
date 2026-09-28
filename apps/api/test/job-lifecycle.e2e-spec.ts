import type { Job, NearbyJob } from '@gigmap/shared';

import {
  ZURICH,
  apply,
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

/** Job status transitions — see docs/job-lifecycle.md. */
describe('Job lifecycle', () => {
  let ctx: TestContext;
  let employer: Actor;
  let workers: Actor[];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.push.reset();
    employer = await signUp(ctx, 'employer');
    workers = [
      await signUp(ctx, 'worker'),
      await signUp(ctx, 'worker'),
      await signUp(ctx, 'worker'),
    ];
  });

  afterAll(() => ctx.close());

  const getJob = async (id: string): Promise<Job> =>
    (await ctx.as(employer).get(`/v1/jobs/${id}`).expect(200)).body as Job;

  const setStatus = (jobId: string, status: 'filled' | 'cancelled') =>
    ctx.as(employer).patch(`/v1/jobs/${jobId}/status`).send({ status });

  const decide = (applicationId: string, status: 'accepted' | 'rejected') =>
    ctx.as(employer).patch(`/v1/applications/${applicationId}`).send({ status });

  const onMap = async (jobId: string): Promise<boolean> => {
    const response = await ctx
      .as(workers[0]!)
      .get(`/v1/jobs/nearby?lat=${ZURICH.latitude}&lng=${ZURICH.longitude}`)
      .expect(200);
    return (response.body as NearbyJob[]).some((job) => job.id === jobId);
  };

  describe('a job the employer marked filled by hand', () => {
    it('refuses further acceptances and stays off the map', async () => {
      const job = await postJob(ctx, employer, { slots: 3 });
      const applicationId = await apply(ctx, workers[0]!, job.id);

      await setStatus(job.id, 'filled').expect(200);
      await decide(applicationId, 'accepted').expect(400);

      expect(await getJob(job.id)).toMatchObject({ status: 'filled', filledSlots: 0 });
      expect(await onMap(job.id)).toBe(false);
    });

    it('is not reopened when an acceptance is withdrawn', async () => {
      const job = await postJob(ctx, employer, { slots: 2 });
      const applicationId = await apply(ctx, workers[0]!, job.id);
      await decide(applicationId, 'accepted').expect(200);

      await setStatus(job.id, 'filled').expect(200);
      await decide(applicationId, 'rejected').expect(200);

      expect(await getJob(job.id)).toMatchObject({ status: 'filled', filledSlots: 0 });
      expect(await onMap(job.id)).toBe(false);
    });
  });

  describe('a job that filled up on its own', () => {
    it('refuses acceptances beyond the headcount with a conflict', async () => {
      const job = await postJob(ctx, employer, { slots: 1 });
      const first = await apply(ctx, workers[0]!, job.id);
      const second = await apply(ctx, workers[1]!, job.id);

      await decide(first, 'accepted').expect(200);
      await decide(second, 'accepted').expect(409);
    });

    it('reopens and returns to the map when an acceptance is withdrawn', async () => {
      const job = await postJob(ctx, employer, { slots: 1 });
      const applicationId = await apply(ctx, workers[0]!, job.id);
      await decide(applicationId, 'accepted').expect(200);
      expect(await onMap(job.id)).toBe(false);

      await decide(applicationId, 'rejected').expect(200);

      expect(await getJob(job.id)).toMatchObject({ status: 'open', filledSlots: 0 });
      expect(await onMap(job.id)).toBe(true);
    });
  });

  describe('editing the headcount', () => {
    it('fills the job when slots shrink to the number already hired', async () => {
      const job = await postJob(ctx, employer, { slots: 3 });
      const applicationId = await apply(ctx, workers[0]!, job.id);
      await decide(applicationId, 'accepted').expect(200);

      await ctx.as(employer).patch(`/v1/jobs/${job.id}`).send({ slots: 1 }).expect(200);

      expect(await getJob(job.id)).toMatchObject({ status: 'filled', slots: 1, filledSlots: 1 });
    });

    it('refuses to shrink below the number already hired', async () => {
      const job = await postJob(ctx, employer, { slots: 3 });
      await decide(await apply(ctx, workers[0]!, job.id), 'accepted').expect(200);
      await decide(await apply(ctx, workers[1]!, job.id), 'accepted').expect(200);

      await ctx.as(employer).patch(`/v1/jobs/${job.id}`).send({ slots: 1 }).expect(400);
    });
  });

  describe('manual status changes', () => {
    it('can cancel a filled job', async () => {
      const job = await postJob(ctx, employer, { slots: 1 });
      await decide(await apply(ctx, workers[0]!, job.id), 'accepted').expect(200);

      await setStatus(job.id, 'cancelled').expect(200);

      expect(await getJob(job.id)).toMatchObject({ status: 'cancelled' });
    });

    it('treats a repeated request as a no-op', async () => {
      const job = await postJob(ctx, employer);

      await setStatus(job.id, 'cancelled').expect(200);
      await setStatus(job.id, 'cancelled').expect(200);
    });

    it('cannot revive a cancelled job or fill an expired one', async () => {
      const cancelled = await postJob(ctx, employer);
      await setStatus(cancelled.id, 'cancelled').expect(200);
      await setStatus(cancelled.id, 'filled').expect(400);

      const expired = await postJob(ctx, employer);
      await ctx.prisma.job.update({ where: { id: expired.id }, data: { status: 'expired' } });
      await setStatus(expired.id, 'filled').expect(400);
    });

    it('refuses any decision on applicants of a cancelled job', async () => {
      const job = await postJob(ctx, employer);
      const applicationId = await apply(ctx, workers[0]!, job.id);
      await setStatus(job.id, 'cancelled').expect(200);

      await decide(applicationId, 'accepted').expect(400);
    });
  });
});
