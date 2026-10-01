import { Global, Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { LifecycleService } from './lifecycle.service';

@Global()
@Module({
  controllers: [HealthController],
  providers: [LifecycleService],
  exports: [LifecycleService],
})
export class HealthModule {}
