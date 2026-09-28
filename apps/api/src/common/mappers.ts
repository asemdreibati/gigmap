import type {
  EmployerProfile,
  Job as JobRow,
  User as UserRow,
  WorkerProfile,
} from '@prisma/client';
import type { Job, PublicUser, SelfUser, WorkerSkill } from '@gigmap/shared';

/**
 * Prisma models are the internal representation; these functions produce the
 * public contract from `@gigmap/shared`. Keeping the two apart is what stops a
 * column rename from becoming a breaking API change — and it is what keeps
 * `email` and `phone` from leaking into responses by accident.
 */

export type UserWithProfiles = UserRow & {
  workerProfile: WorkerProfile | null;
  employerProfile: EmployerProfile | null;
};

/** Include clause that satisfies `UserWithProfiles`. */
export const userProfileInclude = {
  workerProfile: true,
  employerProfile: true,
} as const;

export function toPublicUser(user: UserWithProfiles): PublicUser {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    photoUrl: user.photoUrl,
    bio: user.bio,
    avgRating: user.avgRating.toNumber(),
    ratingCount: user.ratingCount,
    createdAt: user.createdAt.toISOString(),
    ...(user.workerProfile
      ? {
          skills: user.workerProfile.skills as WorkerSkill[],
          experienceYears: user.workerProfile.experienceYears,
        }
      : {}),
    ...(user.employerProfile
      ? {
          companyName: user.employerProfile.companyName,
          website: user.employerProfile.website,
        }
      : {}),
  };
}

export function toSelfUser(user: UserWithProfiles): SelfUser {
  return {
    ...toPublicUser(user),
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
  };
}

export function toJob(job: JobRow & { employer: UserWithProfiles }): Job {
  return {
    id: job.id,
    employerId: job.employerId,
    title: job.title,
    description: job.description,
    category: job.category,
    payAmount: job.payAmount.toNumber(),
    payType: job.payType,
    slots: job.slots,
    filledSlots: job.filledSlots,
    latitude: job.latitude,
    longitude: job.longitude,
    address: job.address,
    startTime: job.startTime.toISOString(),
    durationHours: job.durationHours?.toNumber() ?? null,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    employer: toPublicUser(job.employer),
  };
}
