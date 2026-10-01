import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { setTimeout as sleep } from 'node:timers/promises';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link target, read by the app's notification handler. */
  data?: Record<string, string>;
}

/** Expo asks senders to wait this long before fetching a ticket's receipt. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
/** Expo discards receipts after a day; past that there is nothing to fetch. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
/** Bounds memory if Expo is unreachable for a long stretch. */
export const MAX_PENDING_RECEIPTS = 10_000;
/** How long shutdown waits for sends already under way. */
export const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

interface PendingReceipt {
  token: string;
  sentAt: number;
}

@Injectable()
export class PushService implements OnApplicationShutdown {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;
  /**
   * Tickets awaiting a receipt check, keyed by ticket id, oldest first. Kept
   * in memory: losing them on a restart only delays pruning a dead token
   * until the next push to it. See ADR 0008.
   */
  private readonly pendingReceipts = new Map<string, PendingReceipt>();
  /** Sends under way, so shutdown can let them finish. */
  private readonly inFlight = new Set<Promise<void>>();

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
  sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const send = this.deliver(userId, payload).finally(() => this.inFlight.delete(send));
    this.inFlight.add(send);
    return send;
  }

  /**
   * Runs after the HTTP server has drained, so no new sends can start. A
   * notification triggered by the last requests of a rolling deploy still
   * goes out instead of dying with the container.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }

    const timeout = new AbortController();
    await Promise.race([
      Promise.allSettled(this.inFlight),
      sleep(SHUTDOWN_FLUSH_TIMEOUT_MS, undefined, { signal: timeout.signal }).catch(() => {}),
    ]);
    timeout.abort();
  }

  private async deliver(userId: string, payload: PushPayload): Promise<void> {
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
        await this.handleTickets(chunk, tickets);
      }
    } catch (error) {
      this.logger.error(
        `Push to user ${userId} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Second half of Expo's delivery protocol. A ticket only says Expo accepted
   * the message; the receipt says whether Apple or Google delivered it, and
   * it is where most `DeviceNotRegistered` errors (app uninstalled) show up.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkReceipts(): Promise<void> {
    const now = Date.now();
    const due: string[] = [];

    for (const [ticketId, { sentAt }] of this.pendingReceipts) {
      if (now - sentAt > RECEIPT_TTL_MS) {
        this.pendingReceipts.delete(ticketId);
      } else if (now - sentAt >= RECEIPT_DELAY_MS) {
        due.push(ticketId);
      }
    }

    for (const chunk of this.expo.chunkPushNotificationReceiptIds(due)) {
      try {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        await this.handleReceipts(receipts);
      } catch (error) {
        // Left pending; the next run retries until the TTL runs out.
        this.logger.warn(`Fetching push receipts failed: ${(error as Error).message}`);
      }
    }
  }

  /** Expo returns one ticket per message, in order. */
  private async handleTickets(chunk: ExpoPushMessage[], tickets: ExpoPushTicket[]): Promise<void> {
    const stale: string[] = [];

    tickets.forEach((ticket, index) => {
      const recipient = chunk[index]?.to;
      if (typeof recipient !== 'string') {
        return;
      }

      if (ticket.status === 'ok') {
        this.trackReceipt(ticket.id, recipient);
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        stale.push(recipient);
      } else {
        this.logger.warn(`Push ticket error: ${ticket.message}`);
      }
    });

    await this.deleteTokens(stale);
  }

  private async handleReceipts(receipts: Record<string, ExpoPushReceipt>): Promise<void> {
    const stale: string[] = [];

    for (const [ticketId, receipt] of Object.entries(receipts)) {
      const pending = this.pendingReceipts.get(ticketId);
      this.pendingReceipts.delete(ticketId);

      if (receipt.status === 'ok' || !pending) {
        continue;
      }

      if (receipt.details?.error === 'DeviceNotRegistered') {
        stale.push(pending.token);
      } else {
        this.logger.warn(`Push receipt error: ${receipt.message}`);
      }
    }

    await this.deleteTokens(stale);
  }

  private trackReceipt(ticketId: string, token: string): void {
    if (this.pendingReceipts.size >= MAX_PENDING_RECEIPTS) {
      const oldest = this.pendingReceipts.keys().next();
      if (!oldest.done) {
        this.pendingReceipts.delete(oldest.value);
      }
    }
    this.pendingReceipts.set(ticketId, { token, sentAt: Date.now() });
  }

  /**
   * A `DeviceNotRegistered` token belongs to an uninstalled app or has been
   * rotated. Keeping it would mean retrying a dead token on every future
   * notification.
   */
  private async deleteTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    await this.prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
    this.logger.log(`Pruned ${tokens.length} unregistered push token(s)`);
  }
}
