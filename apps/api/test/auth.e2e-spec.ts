import { randomUUID } from 'node:crypto';

import {
  createTestApp,
  resetDatabase,
  signToken,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

describe('Authentication and onboarding', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(() => resetDatabase(ctx.prisma));

  afterAll(() => ctx.close());

  it('serves the health check without a token', async () => {
    await ctx.anonymous().get('/health').expect(200, { status: 'ok', database: 'up' });
  });

  it('rejects requests without a bearer token', async () => {
    await ctx.anonymous().get('/v1/users/me').expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await signToken(randomUUID(), 'x@example.test');
    const tampered = `${forged.slice(0, -4)}AAAA`;

    await ctx
      .anonymous()
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
  });

  it('requires onboarding before any other route', async () => {
    const id = randomUUID();
    const actor: Actor = {
      id,
      email: 'new@example.test',
      role: 'worker',
      token: await signToken(id, 'new@example.test'),
    };

    await ctx.as(actor).get('/v1/users/me').expect(403);
  });

  it('creates the profile once, taking id and email from the token', async () => {
    const worker = await signUp(ctx, 'worker');

    const self = await ctx.as(worker).get('/v1/users/me').expect(200);
    expect(self.body).toMatchObject({ id: worker.id, email: worker.email, role: 'worker' });

    await ctx
      .as(worker)
      .post('/v1/users/me')
      .send({ role: 'employer', name: 'Changed my mind' })
      .expect(409);
  });

  it('never exposes email or phone on a public profile', async () => {
    const worker = await signUp(ctx, 'worker');
    const employer = await signUp(ctx, 'employer');

    const response = await ctx.as(employer).get(`/v1/users/${worker.id}`).expect(200);

    expect(response.body).not.toHaveProperty('email');
    expect(response.body).not.toHaveProperty('phone');
  });

  it('enforces roles', async () => {
    const worker = await signUp(ctx, 'worker');

    await ctx.as(worker).get('/v1/jobs/mine').expect(403);
  });
});
