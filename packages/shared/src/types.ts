import type {
  ApplicationStatus,
  JobCategory,
  JobStatus,
  PayType,
  UserRole,
  WorkerSkill,
} from './constants';

/**
 * Response shapes returned by the API. These are the contract the clients
 * code against — deliberately hand-written rather than re-exported Prisma
 * models, so that internal schema changes do not silently become breaking
 * API changes.
 *
 * Dates cross the wire as ISO strings.
 */

/** A user as anyone is allowed to see them. Never includes email or phone. */
export interface PublicUser {
  id: string;
  role: UserRole;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  avgRating: number;
  ratingCount: number;
  createdAt: string;
  /** Present only for workers. */
  skills?: WorkerSkill[];
  experienceYears?: number;
  /** Present only for employers. */
  companyName?: string | null;
  website?: string | null;
}

/** The authenticated user's own record — adds the private fields back. */
export interface SelfUser extends PublicUser {
  email: string;
  phone: string | null;
  isActive: boolean;
}

export interface Job {
  id: string;
  employerId: string;
  title: string;
  description: string;
  category: JobCategory;
  payAmount: number;
  payType: PayType;
  slots: number;
  /** Slots already taken by accepted applications. */
  filledSlots: number;
  latitude: number;
  longitude: number;
  address: string;
  startTime: string;
  durationHours: number | null;
  status: JobStatus;
  createdAt: string;
  expiresAt: string;
  employer: PublicUser;
}

/** What the map and list views consume: a job plus its distance from the user. */
export interface NearbyJob extends Job {
  distanceKm: number;
}

export interface Application {
  id: string;
  jobId: string;
  workerId: string;
  status: ApplicationStatus;
  createdAt: string;
  job?: Job;
  worker?: PublicUser;
  /**
   * Employer contact details, released to the worker only once the
   * application is accepted. Null in every other state.
   */
  contact?: {
    name: string;
    phone: string | null;
    email: string;
  } | null;
}

export interface Rating {
  id: string;
  jobId: string;
  raterId: string;
  ratedId: string;
  stars: number;
  createdAt: string;
}

/** Describes one outstanding rating the current user is able to leave. */
export interface PendingRating {
  jobId: string;
  jobTitle: string;
  ratedUser: PublicUser;
  jobEndedAt: string;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'job' | 'user';
  targetId: string;
  reason: string;
  createdAt: string;
}

// --- Transport helpers ------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  total: number;
}

/** Error body produced by the API's exception filter. */
export interface ApiError {
  statusCode: number;
  message: string;
  /** Field-level messages, present on 422 validation failures. */
  errors?: Record<string, string[]>;
}
