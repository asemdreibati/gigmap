import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link target, read by the app's notification handler. */
  data?: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.expo = new Expo({ accessToken: config.get('EXPO_ACCESS_TOKEN', { infer: true }) });
  }

  /**
   * Fire-and-forget: a failed push must never fail the request that triggered
   * it. Callers invoke this with `void` and errors are swallowed after logging.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });

      const recipients = tokens
        .map(({ token }) => token)
        .filter((token) => Expo.isExpoPushToken(token));

      if (recipients.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = recipients.map((to) => ({
        to,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data,
      }));

      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        await this.pruneDeadTokens(chunk, tickets);
      }
    } catch (error) {
      this.logger.error(
        `Push to user ${userId} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Expo returns one ticket per message, in order. A `DeviceNotRegistered`
   * error means the app was uninstalled or the token rotated — keeping it
   * would mean retrying a dead token on every future notification.
   */
  private async pruneDeadTokens(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const stale: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status !== 'error') {
        return;
      }

      const recipient = chunk[index]?.to;
      if (ticket.details?.error === 'DeviceNotRegistered' && typeof recipient === 'string') {
        stale.push(recipient);
      } else {
        this.logger.warn(`Push ticket error: ${ticket.message}`);
      }
    });

    if (stale.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
      this.logger.log(`Pruned ${stale.length} unregistered push token(s)`);
    }
  }
}
