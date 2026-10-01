import { setTimeout as sleep } from 'node:timers/promises';

import { LifecycleService } from '../src/modules/health/lifecycle.service';
import { createTestApp, resetDatabase, signUp, type TestContext } from './support/test-app';

describe('Health checks and shutdown', () => {
  describe('probes', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp();
    });

    afterEach(() => jest.restoreAllMocks());

    afterAll(() => ctx.close());

    it('reports liveness without touching the database', async () => {
      const query = jest.spyOn(ctx.prisma, '$queryRaw');

      await ctx.anonymous().get('/health/live').expect(200, { status: 'ok' });

      expect(query).not.toHaveBeenCalled();
    });

    it('reports ready when the database answers', async () => {
      await ctx.anonymous().get('/health/ready').expect(200, { status: 'ok', database: 'up' });
      await ctx.anonymous().get('/health').expect(200, { status: 'ok', database: 'up' });
    });

    it('reports not ready when the database errors', async () => {
      jest.spyOn(ctx.prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));

      await ctx
        .anonymous()
        .get('/health/ready')
        .expect(503, { status: 'unavailable', database: 'down' });
    });

    it('reports not ready when the database hangs, instead of hanging too', async () => {
      jest
        .spyOn(ctx.prisma, '$queryRaw')
        .mockReturnValue(new Promise(() => {}) as ReturnType<typeof ctx.prisma.$queryRaw>);

      const started = Date.now();
      await ctx.anonymous().get('/health/ready').expect(503);

      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('stays live while not ready', async () => {
      jest.spyOn(ctx.prisma, '$queryRaw').mockRejectedValue(new Error('down'));

      await ctx.anonymous().get('/health/live').expect(200);
    });
  });

  describe('graceful shutdown', () => {
    it('fails readiness but keeps serving requests while draining', async () => {
      const ctx = await createTestApp({ shutdownDrainMs: 1_000 });
      await resetDatabase(ctx.prisma);
      const worker = await signUp(ctx, 'worker');

      const closing = ctx.close();
      await sleep(100);

      expect(ctx.app.get(LifecycleService).isDraining).toBe(true);
      await ctx.anonymous().get('/health/ready').expect(503, { status: 'draining' });
      await ctx.anonymous().get('/health/live').expect(200);
      // The database pool is still there for requests that arrive late.
      await ctx.as(worker).get('/v1/users/me').expect(200);

      await closing;
    });
  });
});
