import { randomUUID } from 'node:crypto';

import { TEST_SUPABASE_URL } from './support/env';
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

  it('tags responses with a request id, reusing a well-formed upstream one', async () => {
    const generated = await ctx.anonymous().get('/v1/users/me').expect(401);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const upstream = await ctx
      .anonymous()
      .get('/v1/users/me')
      .set('X-Request-Id', 'lb-trace-0001')
      .expect(401);
    expect(upstream.headers['x-request-id']).toBe('lb-trace-0001');
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

  it('clears optional profile fields when sent null', async () => {
    const employer = await signUp(ctx, 'employer');
    await ctx
      .as(employer)
      .patch('/v1/users/me')
      .send({ bio: 'Family bakery', website: 'https://example.test' })
      .expect(200);

    const response = await ctx
      .as(employer)
      .patch('/v1/users/me')
      .send({ phone: null, bio: null, website: null })
      .expect(200);

    expect(response.body).toMatchObject({ phone: null, bio: null, website: null });
  });

  it('only accepts profile photos from the user’s own avatar folder', async () => {
    const worker = await signUp(ctx, 'worker');
    const folder = `${TEST_SUPABASE_URL}/storage/v1/object/public/avatars`;

    await ctx
      .as(worker)
      .patch('/v1/users/me')
      .send({ photoUrl: 'https://tracker.example/pixel.gif' })
      .expect(422);

    const own = `${folder}/${worker.id}/face.jpg`;
    const response = await ctx.as(worker).patch('/v1/users/me').send({ photoUrl: own }).expect(200);
    expect(response.body).toMatchObject({ photoUrl: own });
  });

  it('enforces roles', async () => {
    const worker = await signUp(ctx, 'worker');

    await ctx.as(worker).get('/v1/jobs/mine').expect(403);
  });
});
