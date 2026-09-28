import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Job, UserRole } from '@gigmap/shared';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PushService } from '../../src/modules/notifications/push.service';
import { TEST_JWT_SECRET, TEST_SUPABASE_URL } from './env';
import { FakePushService } from './fake-push.service';

export interface Actor {
  id: string;
  email: string;
  role: UserRole;
  token: string;
}

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  push: FakePushService;
  /** Requests as the given actor. */
  as(actor: Actor): AuthedRequests;
  /** Requests with no credentials. */
  anonymous(): request.Agent;
  close(): Promise<void>;
}

export interface AuthedRequests {
  get(url: string): request.Test;
  post(url: string): request.Test;
  patch(url: string): request.Test;
  delete(url: string): request.Test;
}

export async function createTestApp(): Promise<TestContext> {
  const push = new FakePushService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PushService)
    .useValue(push)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: ['error'] });
  configureApp(app);
  await app.init();

  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  const as = (actor: Actor): AuthedRequests => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${actor.token}`);
    return {
      get: (url) => auth(request(server).get(url)),
      post: (url) => auth(request(server).post(url)),
      patch: (url) => auth(request(server).patch(url)),
      delete: (url) => auth(request(server).delete(url)),
    };
  };

  return {
    app,
    prisma,
    push,
    as,
    anonymous: () => request.agent(server),
    close: () => app.close(),
  };
}

/** Wipes every table between tests. Order-independent thanks to CASCADE. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "users", "worker_profiles", "employer_profiles", "jobs", "applications", ' +
      '"ratings", "reports", "push_tokens" CASCADE',
  );
}

/** A Supabase-shaped access token for a user who has not onboarded yet. */
export async function signToken(id: string, email: string): Promise<string> {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuer(`${TEST_SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

/** Signs up through Supabase (simulated) and completes onboarding via the API. */
export async function signUp(ctx: TestContext, role: UserRole, name?: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${role}-${id.slice(0, 8)}@example.test`;
  const actor: Actor = { id, email, role, token: await signToken(id, email) };

  await ctx
    .as(actor)
    .post('/v1/users/me')
    .send({ role, name: name ?? `Test ${role}`, phone: '+41790000000' })
    .expect(201);

  return actor;
}

export const ZURICH = { latitude: 47.3769, longitude: 8.5417 } as const;

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function postJob(
  ctx: TestContext,
  employer: Actor,
  overrides: Record<string, unknown> = {},
): Promise<Job> {
  const response = await ctx
    .as(employer)
    .post('/v1/jobs')
    .send({
      title: 'Bar help',
      description: 'Help behind the bar for the evening',
      category: 'hospitality',
      payAmount: 30,
      payType: 'hourly',
      slots: 1,
      ...ZURICH,
      address: 'Bahnhofplatz, Zürich',
      startTime: hoursFromNow(24).toISOString(),
      ...overrides,
    })
    .expect(201);

  return response.body as Job;
}

export async function apply(ctx: TestContext, worker: Actor, jobId: string): Promise<string> {
  const response = await ctx.as(worker).post(`/v1/jobs/${jobId}/applications`).expect(201);
  return (response.body as { id: string }).id;
}
