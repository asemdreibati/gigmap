import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateRatingInput, PendingRating, Rating } from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toPublicUser, userProfileInclude } from '../../common/mappers';
import type { AuthenticatedUser } from '../../common/guards/authenticated-user';

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Eligibility is enforced here rather than by a database policy: the rule
   * spans three tables (an accepted application must link the two users on a
   * job whose start time has passed) and is not expressible as a row predicate.
   *
   * Without this check any authenticated user could rate any other user for a
   * job they never worked, which would make `avg_rating` meaningless.
   */
  async create(auth: AuthenticatedUser, input: CreateRatingInput): Promise<Rating> {
    if (input.ratedId === auth.id) {
      throw new BadRequestException('You cannot rate yourself');
    }

    const job = await this.prisma.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, employerId: true, startTime: true, status: true },
    });

    if (!job) {
      throw new BadRequestException('Job not found');
    }

    if (job.status === 'cancelled') {
      throw new BadRequestException('This job was cancelled');
    }

    if (job.startTime > new Date()) {
      throw new BadRequestException('You can rate once the job has started');
    }

    // Exactly one of the two parties is the employer; the other must be a
    // worker who was accepted for this job.
    const workerId = auth.id === job.employerId ? input.ratedId : auth.id;
    const employerSide = auth.id === job.employerId ? auth.id : input.ratedId;

    if (employerSide !== job.employerId) {
      throw new ForbiddenException('You were not involved in this job');
    }

    const accepted = await this.prisma.application.findFirst({
      where: { jobId: job.id, workerId, status: 'accepted' },
      select: { id: true },
    });

    if (!accepted) {
      throw new ForbiddenException('You were not involved in this job');
    }

    try {
      const rating = await this.prisma.rating.create({
        data: {
          jobId: input.jobId,
          raterId: auth.id,
          ratedId: input.ratedId,
          stars: input.stars,
        },
      });

      return toRating(rating);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already rated this person for this job');
      }
      throw error;
    }
  }

  /** Drives the "rate your last job" prompt on both sides. */
  async findPending(auth: AuthenticatedUser): Promise<PendingRating[]> {
    const now = new Date();

    const applications = await this.prisma.application.findMany({
      where: {
        status: 'accepted',
        ...(auth.role === 'worker'
          ? {
              workerId: auth.id,
              job: { startTime: { lt: now }, status: { not: 'cancelled' as const } },
            }
          : {
              job: {
                employerId: auth.id,
                startTime: { lt: now },
                status: { not: 'cancelled' as const },
              },
            }),
      },
      include: {
        worker: { include: userProfileInclude },
        job: { include: { employer: { include: userProfileInclude } } },
      },
    });

    if (applications.length === 0) {
      return [];
    }

    const alreadyRated = await this.prisma.rating.findMany({
      where: {
        raterId: auth.id,
        jobId: { in: applications.map((application) => application.jobId) },
      },
      select: { jobId: true, ratedId: true },
    });

    const rated = new Set(alreadyRated.map(({ jobId, ratedId }) => `${jobId}:${ratedId}`));

    return applications
      .map((application) => {
        const counterparty =
          auth.role === 'worker' ? application.job.employer : application.worker;

        return {
          jobId: application.jobId,
          jobTitle: application.job.title,
          ratedUser: toPublicUser(counterparty),
          jobEndedAt: endOf(application.job.startTime, application.job.durationHours),
        };
      })
      .filter((pending) => !rated.has(`${pending.jobId}:${pending.ratedUser.id}`));
  }
}

function endOf(startTime: Date, durationHours: Prisma.Decimal | null): string {
  const hours = durationHours?.toNumber() ?? 0;
  return new Date(startTime.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function toRating(rating: {
  id: string;
  jobId: string;
  raterId: string;
  ratedId: string;
  stars: number;
  createdAt: Date;
}): Rating {
  return {
    id: rating.id,
    jobId: rating.jobId,
    raterId: rating.raterId,
    ratedId: rating.ratedId,
    stars: rating.stars,
    createdAt: rating.createdAt.toISOString(),
  };
}
