import { Global, Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Global()
@Module({
  providers: [PushService, EmailService, NotificationsService],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
