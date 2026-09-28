/**
 * Single source of truth for the closed vocabularies used across the API,
 * the mobile app and the web app. The Prisma enums mirror these exactly —
 * if you add a value here, add it to `apps/api/prisma/schema.prisma` and
 * generate a migration.
 */

export const USER_ROLES = ['worker', 'employer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const JOB_STATUSES = ['open', 'filled', 'expired', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PAY_TYPES = ['hourly', 'fixed'] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const JOB_CATEGORIES = [
  'delivery',
  'hospitality',
  'events',
  'cleaning',
  'warehouse',
  'retail',
  'admin',
  'construction',
  'other',
] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const REPORT_TARGET_TYPES = ['job', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Predefined skill tags offered in the worker profile multi-select. */
export const WORKER_SKILLS = [
  'delivery',
  'driving',
  'hospitality',
  'bartending',
  'barista',
  'kitchen',
  'events',
  'promotion',
  'cleaning',
  'warehouse',
  'forklift',
  'retail',
  'cashier',
  'admin',
  'customer-service',
  'construction',
  'gardening',
  'moving',
] as const;
export type WorkerSkill = (typeof WORKER_SKILLS)[number];

/** Display labels. Keys stay stable; only labels get translated in phase 2. */
export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  delivery: 'Delivery',
  hospitality: 'Hospitality',
  events: 'Events',
  cleaning: 'Cleaning',
  warehouse: 'Warehouse',
  retail: 'Retail',
  admin: 'Admin',
  construction: 'Construction',
  other: 'Other',
};

// --- Geo / search tuning ----------------------------------------------------

export const RADIUS_KM_MIN = 1;
export const RADIUS_KM_MAX = 30;
export const RADIUS_KM_DEFAULT = 10;

/** Hard cap on rows returned by a single nearby query, to bound map payloads. */
export const NEARBY_JOBS_LIMIT = 200;

/**
 * Minimum lifetime of a job posting, counted from when it was posted. A job
 * starting later than this stays up until its start time.
 */
export const JOB_EXPIRY_DAYS = 7;

/** v1 is Switzerland-only: single currency, single timezone. */
export const CURRENCY = 'CHF';
export const DEFAULT_TIMEZONE = 'Europe/Zurich';

/** Map fallback when GPS is unavailable — Zurich centre. */
export const FALLBACK_CENTER = { latitude: 47.3769, longitude: 8.5417 } as const;

// --- Storage ---------------------------------------------------------------

/**
 * Public Supabase Storage bucket for profile photos. Clients upload to
 * `<user id>/<file name>` inside it and send the resulting public URL as
 * `photoUrl`; the API rejects URLs anywhere else. See docs/supabase-setup.md.
 */
export const AVATAR_BUCKET = 'avatars';
