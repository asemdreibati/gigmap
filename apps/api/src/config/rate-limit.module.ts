import { Module } from '@nestjs/common';

import { RateLimitStorage } from './rate-limit-storage';

@Module({
  providers: [RateLimitStorage],
  exports: [RateLimitStorage],
})
export class RateLimitModule {}
