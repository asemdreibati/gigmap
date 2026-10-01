-- Expiry reminders are claimed per job, so each one is sent exactly once
-- however many API instances run the scheduler (ADR 0013).
ALTER TABLE "jobs" ADD COLUMN "expiry_reminder_sent_at" TIMESTAMPTZ(6);
