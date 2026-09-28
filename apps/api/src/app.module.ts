import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { HealthController } from './health.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { RolesGuard } from './common/guards/roles.guard';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { validateEnv } from './config/env';
import { ApplicationsModule } from './modules/applications/applications.module';
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
    PrismaModule,
    NotificationsModule,
    UsersModule,
    JobsModule,
    ApplicationsModule,
    RatingsModule,
    ReportsModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authentication resolves the role that RolesGuard reads.
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
