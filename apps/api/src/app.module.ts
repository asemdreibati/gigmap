import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './common/prisma/prisma.module';
import { RolesGuard } from './common/guards/roles.guard';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { validateEnv } from './config/env';
import { throttlerOptions } from './config/rate-limits';
import { ApplicationsModule } from './modules/applications/applications.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Loaded from the repo root so the API and the web app share one file.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(throttlerOptions),
    PrismaModule,
    HealthModule,
    NotificationsModule,
    UsersModule,
    JobsModule,
    ApplicationsModule,
    RatingsModule,
    ReportsModule,
    MaintenanceModule,
  ],
  providers: [
    // Order matters: authentication resolves the user that RolesGuard and
    // the per-user rate limit read.
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
