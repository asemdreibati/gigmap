import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import type { Env } from '../../config/env';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly adminEmail?: string;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.adminEmail = config.get('ADMIN_EMAIL', { infer: true });
    // Optional in development — the API should boot without an email provider.
    this.resend = apiKey ? new Resend(apiKey) : null;

    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set - outbound email is disabled');
    }
  }

  async sendToAdmin(subject: string, text: string): Promise<void> {
    if (!this.resend || !this.adminEmail) {
      this.logger.log(`[email suppressed] ${subject}\n${text}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: 'GigMap <alerts@gigmap.ch>',
        to: this.adminEmail,
        subject,
        text,
      });
    } catch (error) {
      this.logger.error(`Failed to email admin: ${(error as Error).message}`);
    }
  }
}
