import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  JOB_CATEGORIES,
  PAY_TYPES,
  PUSH_PLATFORMS,
  RADIUS_KM_DEFAULT,
  RADIUS_KM_MAX,
  RADIUS_KM_MIN,
  REPORT_TARGET_TYPES,
  USER_ROLES,
  WORKER_SKILLS,
  NEARBY_JOBS_LIMIT,
} from './constants';

/**
 * Request schemas shared by the API (validation pipe) and both clients
 * (react-hook-form resolvers). One definition, so a form can never disagree
 * with what the server will accept.
 */

// --- Primitives -------------------------------------------------------------

export const uuidSchema = z.string().uuid();

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

/** Accepts ISO strings (JSON) and Dates (forms); must lie in the future. */
export const futureDateSchema = z.coerce
  .date()
  .refine((date) => date.getTime() > Date.now(), 'Start time must be in the future');

// --- Users / profiles -------------------------------------------------------

/**
 * Sent once, right after Supabase sign-up, from the role-select screen.
 * The role is immutable afterwards: a worker's ratings are not transferable
 * to an employer identity, and applications/jobs key off it.
 */
export const createProfileSchema = z.object({
  role: z.enum(USER_ROLES),
  name: z.string().trim().min(2, 'Name is too short').max(80),
  phone: z.string().trim().min(6).max(30).optional(),
});

/**
 * Every field is optional; omit it to leave it unchanged. Optional profile
 * fields also accept `null`, which clears them.
 */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(6).max(30).nullish(),
  bio: z.string().trim().max(500).nullish(),
  photoUrl: z.string().url().max(500).nullish(),
  // worker-only
  skills: z.array(z.enum(WORKER_SKILLS)).max(10).optional(),
  experienceYears: z.number().int().min(0).max(60).optional(),
  // employer-only
  companyName: z.string().trim().min(2).max(120).nullish(),
  website: z.string().url().max(200).nullish(),
});

// --- Jobs -------------------------------------------------------------------

export const createJobSchema = z.object({
  title: z.string().trim().min(3, 'Title is too short').max(100),
  description: z.string().trim().min(10, 'Add a few more details').max(2000),
  category: z.enum(JOB_CATEGORIES),
  payAmount: z
    .number()
    .positive('Pay must be greater than zero')
    .max(100_000)
    .multipleOf(0.01, 'Pay can have at most 2 decimals'),
  payType: z.enum(PAY_TYPES),
  slots: z.number().int().min(1).max(50).default(1),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  address: z.string().trim().min(3).max(300),
  startTime: futureDateSchema,
  durationHours: z.number().positive().max(24).optional(),
});

/** Omit a field to leave it unchanged; `durationHours: null` clears it. */
export const updateJobSchema = z.object({
  title: z.string().trim().min(3).max(100).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  category: z.enum(JOB_CATEGORIES).optional(),
  payAmount: z.number().positive().max(100_000).multipleOf(0.01).optional(),
  payType: z.enum(PAY_TYPES).optional(),
  slots: z.number().int().min(1).max(50).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  address: z.string().trim().min(3).max(300).optional(),
  startTime: futureDateSchema.optional(),
  durationHours: z.number().positive().max(24).nullish(),
});

/**
 * Employers may only drive a job to these two states by hand. `open` is the
 * initial value, `expired` is set by the scheduled sweep, and `filled` is set
 * automatically when the last slot is taken.
 */
export const updateJobStatusSchema = z.object({
  status: z.enum(['filled', 'cancelled']),
});

/** Query string for the map/list view — everything arrives as a string. */
export const nearbyJobsQuerySchema = z.object({
  lat: z.coerce.number().pipe(latitudeSchema),
  lng: z.coerce.number().pipe(longitudeSchema),
  radiusKm: z.coerce.number().min(RADIUS_KM_MIN).max(RADIUS_KM_MAX).default(RADIUS_KM_DEFAULT),
  category: z.enum(JOB_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(NEARBY_JOBS_LIMIT).default(NEARBY_JOBS_LIMIT),
});

// --- Applications -----------------------------------------------------------

export const updateApplicationSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

export const listApplicationsQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
});

// --- Ratings ----------------------------------------------------------------

export const createRatingSchema = z.object({
  jobId: uuidSchema,
  ratedId: uuidSchema,
  stars: z.number().int().min(1).max(5),
});

// --- Reports ----------------------------------------------------------------

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: uuidSchema,
  reason: z.string().trim().min(10, 'Tell us what went wrong').max(1000),
});

// --- Push tokens ------------------------------------------------------------

export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(10).max(255),
  platform: z.enum(PUSH_PLATFORMS),
});

// --- Inferred input types ---------------------------------------------------

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type UpdateJobStatusInput = z.infer<typeof updateJobStatusSchema>;
export type NearbyJobsQuery = z.infer<typeof nearbyJobsQuerySchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
export type CreateRatingInput = z.infer<typeof createRatingSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
