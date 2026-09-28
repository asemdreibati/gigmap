import type { Application, Job } from '@gigmap/shared';

import {
  apply,
  createTestApp,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Applications', () => {
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

  const getJob = async (id: string): Promise<Job> =>
    (await ctx.as(employer).get(`/v1/jobs/${id}`).expect(200)).body as Job;

  const decide = (applicationId: string, status: 'accepted' | 'rejected') =>
    ctx.as(employer).patch(`/v1/applications/${applicationId}`).send({ status });

  it('notifies the employer of a new applicant', async () => {
    const job = await postJob(ctx, employer);
    await apply(ctx, worker, job.id);

    expect(ctx.push.typesFor(employer.id)).toEqual(['application.created']);
  });

  it('rejects a second application from the same worker', async () => {
    const job = await postJob(ctx, employer);
    await apply(ctx, worker, job.id);

    await ctx.as(worker).post(`/v1/jobs/${job.id}/applications`).expect(409);
  });

  it('releases contact details to both sides only once accepted', async () => {
    const job = await postJob(ctx, employer);
    const applicationId = await apply(ctx, worker, job.id);

    const before = await ctx.as(worker).get('/v1/applications/mine').expect(200);
    expect((before.body as Application[])[0]!.contact).toBeNull();

    await decide(applicationId, 'accepted').expect(200);

    const workerView = await ctx.as(worker).get('/v1/applications/mine').expect(200);
    expect((workerView.body as Application[])[0]!.contact).toMatchObject({
      email: employer.email,
    });

    const employerView = await ctx.as(employer).get(`/v1/jobs/${job.id}/applications`).expect(200);
    expect((employerView.body as Application[])[0]!.contact).toMatchObject({
      email: worker.email,
    });
  });

  it('fills the job when the last slot is taken and reopens it on withdrawal', async () => {
    const job = await postJob(ctx, employer, { slots: 1 });
    const applicationId = await apply(ctx, worker, job.id);

    await decide(applicationId, 'accepted').expect(200);
    expect(await getJob(job.id)).toMatchObject({ status: 'filled', filledSlots: 1 });

    await decide(applicationId, 'rejected').expect(200);
    expect(await getJob(job.id)).toMatchObject({ status: 'open', filledSlots: 0 });
  });

  it('never overfills a job when two acceptances race for the last slot', async () => {
    const job = await postJob(ctx, employer, { slots: 1 });
    const other = await signUp(ctx, 'worker');
    const first = await apply(ctx, worker, job.id);
    const second = await apply(ctx, other, job.id);

    const results = await Promise.all([decide(first, 'accepted'), decide(second, 'accepted')]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await getJob(job.id)).toMatchObject({ status: 'filled', filledSlots: 1 });
  });

  it("forbids deciding on another employer's applicants", async () => {
    const job = await postJob(ctx, employer);
    const applicationId = await apply(ctx, worker, job.id);
    const other = await signUp(ctx, 'employer');

    await ctx
      .as(other)
      .patch(`/v1/applications/${applicationId}`)
      .send({ status: 'accepted' })
      .expect(403);
  });
});
