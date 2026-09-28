import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProfileInput,
  PublicUser,
  RegisterPushTokenInput,
  SelfUser,
  UpdateProfileInput,
} from '@gigmap/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toPublicUser, toSelfUser, userProfileInclude } from '../../common/mappers';
import type { AuthenticatedUser } from '../../common/guards/authenticated-user';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called once from the role-select screen, straight after Supabase sign-up.
   * The role is fixed from here on: ratings, jobs and applications are all
   * keyed off it, so switching would strand existing records.
   */
  async createProfile(auth: AuthenticatedUser, input: CreateProfileInput): Promise<SelfUser> {
    const existing = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (existing) {
      throw new ConflictException('Profile already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        // Trusting the verified token, not the request body — a client cannot
        // claim someone else's id or email.
        id: auth.id,
        email: auth.email,
        role: input.role,
        name: input.name,
        phone: input.phone,
        ...(input.role === 'worker'
          ? { workerProfile: { create: {} } }
          : { employerProfile: { create: {} } }),
      },
      include: userProfileInclude,
    });

    return toSelfUser(user);
  }

  async findSelf(id: string): Promise<SelfUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userProfileInclude,
    });

    if (!user) {
      throw new NotFoundException('Profile not found');
    }

    return toSelfUser(user);
  }

  async findPublic(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userProfileInclude,
    });

    if (!user || !user.isActive) {
      throw new NotFoundException('User not found');
    }

    return toPublicUser(user);
  }

  async update(auth: AuthenticatedUser, input: UpdateProfileInput): Promise<SelfUser> {
    const { skills, experienceYears, companyName, website, ...shared } = input;

    const isWorker = auth.role === 'worker';
    // Role-specific fields are silently ignored for the other role rather than
    // rejected, so a shared profile form can post the whole object.
    const workerData = isWorker ? { skills, experienceYears } : undefined;
    const employerData = !isWorker ? { companyName, website } : undefined;

    const user = await this.prisma.user.update({
      where: { id: auth.id },
      data: {
        ...shared,
        ...(workerData && hasValue(workerData)
          ? { workerProfile: { upsert: { create: workerData, update: workerData } } }
          : {}),
        ...(employerData && hasValue(employerData)
          ? { employerProfile: { upsert: { create: employerData, update: employerData } } }
          : {}),
      },
      include: userProfileInclude,
    });

    return toSelfUser(user);
  }

  async registerPushToken(userId: string, input: RegisterPushTokenInput): Promise<void> {
    // Tokens migrate between users when a device is shared or an account is
    // switched, so claim it for the current user rather than failing.
    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: { token: input.token, userId, platform: input.platform },
      update: { userId, platform: input.platform },
    });
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }
}

function hasValue(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => value !== undefined);
}
