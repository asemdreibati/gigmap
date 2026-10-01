import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import {
  apply,
  createTestApp,
  hoursFromNow,
  postJob,
  resetDatabase,
  signUp,
  type Actor,
  type TestContext,
} from './support/test-app';

/**
 * Scheduled jobs run on every API instance (ADR 0013). These tests run two
 * instances against one database to prove concurrent runs never repeat work.
 */
describe('Scheduled jobs across instances', () => {
  let a: TestContext;
  let b: TestContext;
  let employer: Actor;

  beforeAll(async () => {
    [a, b] = await Promise.all([createTestApp(), createTestApp()]);
  });

  beforeEach(async () => {
    await resetDatabase(a.prisma);
    a.push.reset();
    b.push.reset();
    employer = await signUp(a, 'employer');
  });

  afterAll(() => Promise.all([a.close(), b.close()]));

  const remindersTo = (userId: string) =>
    [...a.push.sent, ...b.push.sent].filter(
      (push) => push.userId === userId && push.payload.data?.['type'] === 'job.expiring',
    );

  const expireIn = (jobId: string, hours: number) =>
    a.prisma.job.update({ where: { id: jobId }, data: { expiresAt: hoursFromNow(hours) } });

  const runReminders = () =>
    Promise.all([
      a.app.get(MaintenanceService).notifyExpiringJobs(),
      b.app.get(MaintenanceService).notifyExpiringJobs(),
    ]);

  describe('expiry reminders', () => {
    it('reminds once per job, even when every instance runs at the same moment', async () => {
      const job = await postJob(a, employer);
      await expireIn(job.id, 12);

      await runReminders();
      await runReminders();

      expect(remindersTo(employer.id)).toHaveLength(1);
      expect(remindersTo(employer.id)[0]?.payload.data).toMatchObject({ jobId: job.id });
    });

    it('only reminds about open jobs leaving the map within a day', async () => {
      const later = await postJob(a, employer);
      await expireIn(later.id, 72);
      const filled = await postJob(a, employer);
      await expireIn(filled.id, 12);
      await a.prisma.job.update({ where: { id: filled.id }, data: { status: 'filled' } });

      await runReminders();

      expect(remindersTo(employer.id)).toHaveLength(0);
    });

    it('reminds again after an edit moves the expiry', async () => {
      const job = await postJob(a, employer);
      await expireIn(job.id, 12);
      await runReminders();

      await a
        .as(employer)
        .patch(`/v1/jobs/${job.id}`)
        .send({ startTime: hoursFromNow(48).toISOString() })
        .expect(200);

      const row = await a.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(row.expiryReminderSentAt).toBeNull();
    });
  });

  describe('expiry sweep', () => {
    it('expires a job and notifies its applicants once, across instances', async () => {
      const worker = await signUp(a, 'worker');
      const job = await postJob(a, employer);
      await apply(a, worker, job.id);
      await expireIn(job.id, -1);

      await Promise.all([
        a.app.get(MaintenanceService).expireStaleJobs(),
        b.app.get(MaintenanceService).expireStaleJobs(),
      ]);

      const closed = [...a.push.sent, ...b.push.sent].filter(
        (push) => push.userId === worker.id && push.payload.data?.['type'] === 'application.closed',
      );
      expect(closed).toHaveLength(1);
    });
  });
});
