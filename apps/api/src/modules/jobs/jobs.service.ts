import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  JOB_EXPIRY_DAYS,
  type CreateJobInput,
  type Job,
  type JobCategory,
  type JobStatus,
  type NearbyJob,
  type NearbyJobsQuery,
  type PayType,
  type UpdateJobInput,
  type UpdateJobStatusInput,
} from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJob, userProfileInclude } from '../../common/mappers';
import { rejectPendingApplications } from '../applications/application-closure';
import { NotificationsService } from '../notifications/notifications.service';
import { isFull, manualTransitionError } from './job-lifecycle';
import { lockJob, requireOwnedJob } from './job-lock';

/** Shape returned by the raw radius query; aliases are already camelCase. */
interface NearbyJobRow {
  id: string;
  employerId: string;
  title: string;
  description: string;
  category: JobCategory;
  payAmount: number;
  payType: PayType;
  slots: number;
  filledSlots: number;
  latitude: number;
  longitude: number;
  address: string;
  startTime: Date;
  durationHours: number | null;
  status: JobStatus;
  createdAt: Date;
  expiresAt: Date;
  distanceKm: number;
  employerName: string;
  employerPhotoUrl: string | null;
  employerBio: string | null;
  employerAvgRating: number;
  employerRatingCount: number;
  employerCreatedAt: Date;
  employerCompanyName: string | null;
  employerWebsite: string | null;
}

const jobWithEmployer = {
  employer: { include: userProfileInclude },
} as const;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The map and list views both read from here.
   *
   * Runs as raw SQL because the radius test is a PostGIS predicate Prisma
   * cannot express. `ST_DWithin` against the GiST index on `location` is what
   * keeps this fast as the table grows — a naive distance filter would force a
   * sequential scan over every job in the country.
   */
  async findNearby(query: NearbyJobsQuery): Promise<NearbyJob[]> {
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}::float8, ${query.lat}::float8), 4326)::geography`;
    const category = query.category ?? null;

    const rows = await this.prisma.$queryRaw<NearbyJobRow[]>`
      SELECT
        j."id",
        j."employer_id"             AS "employerId",
        j."title",
        j."description",
        j."category"::text          AS "category",
        j."pay_amount"::float8      AS "payAmount",
        j."pay_type"::text          AS "payType",
        j."slots",
        j."filled_slots"            AS "filledSlots",
        j."latitude",
        j."longitude",
        j."address",
        j."start_time"              AS "startTime",
        j."duration_hours"::float8  AS "durationHours",
        j."status"::text            AS "status",
        j."created_at"              AS "createdAt",
        j."expires_at"              AS "expiresAt",
        ROUND((ST_Distance(j."location", ${point}) / 1000)::numeric, 2)::float8 AS "distanceKm",
        u."name"                    AS "employerName",
        u."photo_url"               AS "employerPhotoUrl",
        u."bio"                     AS "employerBio",
        u."avg_rating"::float8      AS "employerAvgRating",
        u."rating_count"            AS "employerRatingCount",
        u."created_at"              AS "employerCreatedAt",
        ep."company_name"           AS "employerCompanyName",
        ep."website"                AS "employerWebsite"
      FROM "jobs" j
      JOIN "users" u ON u."id" = j."employer_id"
      LEFT JOIN "employer_profiles" ep ON ep."id" = u."id"
      WHERE j."status" = 'open'
        AND j."expires_at" > NOW()
        AND j."filled_slots" < j."slots"
        AND u."is_active" = true
        AND ST_DWithin(j."location", ${point}, ${query.radiusKm * 1000}::float8)
        AND (${category}::text IS NULL OR j."category"::text = ${category}::text)
      ORDER BY "distanceKm" ASC
      LIMIT ${query.limit}::int
    `;

    return rows.map(toNearbyJob);
  }

  async findOne(id: string): Promise<Job> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: jobWithEmployer,
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return toJob(job);
  }

  /** Employer's own jobs, newest first, in every status. */
  async findByEmployer(employerId: string): Promise<Job[]> {
    const jobs = await this.prisma.job.findMany({
      where: { employerId },
      include: jobWithEmployer,
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map(toJob);
  }

  async create(employerId: string, input: CreateJobInput): Promise<Job> {
    const { latitude, longitude, ...rest } = input;

    const job = await this.prisma.job.create({
      data: {
        ...rest,
        employerId,
        latitude,
        longitude,
        expiresAt: defaultExpiry(input.startTime),
      },
      include: jobWithEmployer,
    });

    return toJob(job);
  }

  async update(employerId: string, id: string, input: UpdateJobInput): Promise<Job> {
    const closed = await this.prisma.$transaction(async (tx) => {
      // Locked so a concurrent acceptance cannot change `filled_slots`
      // between the check below and the write.
      const job = requireOwnedJob(await lockJob(tx, id, 'update'), employerId);

      if (job.status !== 'open') {
        throw new BadRequestException('Only open jobs can be edited');
      }

      const slots = input.slots ?? job.slots;
      if (slots < job.filledSlots) {
        throw new BadRequestException(
          `You have already accepted ${job.filledSlots} worker(s); slots cannot go below that`,
        );
      }

      // Shrinking the headcount to what is already hired fills the job,
      // exactly as accepting the last applicant would have.
      const fills = isFull({ slots, filledSlots: job.filledSlots });

      await tx.job.update({
        where: { id },
        data: {
          ...input,
          ...(input.startTime ? { expiresAt: defaultExpiry(input.startTime) } : {}),
          ...(fills ? { status: 'filled' as const } : {}),
        },
      });

      return fills ? rejectPendingApplications(tx, [id]) : [];
    });

    this.notifications.applicationsClosed(closed, 'filled');

    return this.findOne(id);
  }

  async updateStatus(employerId: string, id: string, input: UpdateJobStatusInput): Promise<Job> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const job = requireOwnedJob(await lockJob(tx, id, 'update'), employerId);

      const error = manualTransitionError(job.status, input.status);
      if (error) {
        throw new BadRequestException(error);
      }

      if (job.status === input.status) {
        return null;
      }

      await tx.job.update({ where: { id }, data: { status: input.status } });

      const hired =
        input.status === 'cancelled'
          ? await tx.application.findMany({
              where: { jobId: id, status: 'accepted' },
              select: { workerId: true },
            })
          : [];

      return { job, hired, closed: await rejectPendingApplications(tx, [id]) };
    });

    if (outcome) {
      this.notifications.applicationsClosed(outcome.closed, input.status);
      for (const { workerId } of outcome.hired) {
        this.notifications.hiredJobCancelled(workerId, id, outcome.job.title);
      }
    }

    return this.findOne(id);
  }
}

/**
 * A posting stays visible until its start time, or the standard window,
 * whichever is later — a job starting three weeks out should not vanish from
 * the map after seven days.
 */
function defaultExpiry(startTime: Date): Date {
  const standard = new Date(Date.now() + JOB_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return startTime > standard ? startTime : standard;
}

function toNearbyJob(row: NearbyJobRow): NearbyJob {
  return {
    id: row.id,
    employerId: row.employerId,
    title: row.title,
    description: row.description,
    category: row.category,
    payAmount: row.payAmount,
    payType: row.payType,
    slots: row.slots,
    filledSlots: row.filledSlots,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    startTime: row.startTime.toISOString(),
    durationHours: row.durationHours,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    distanceKm: row.distanceKm,
    employer: {
      id: row.employerId,
      role: 'employer',
      name: row.employerName,
      photoUrl: row.employerPhotoUrl,
      bio: row.employerBio,
      avgRating: row.employerAvgRating,
      ratingCount: row.employerRatingCount,
      createdAt: row.employerCreatedAt.toISOString(),
      companyName: row.employerCompanyName,
      website: row.employerWebsite,
    },
  };
}
