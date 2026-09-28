import type { PushPayload } from '../../src/modules/notifications/push.service';

export interface SentPush {
  userId: string;
  payload: PushPayload;
}

/**
 * Stands in for PushService so tests can assert on what would have been sent
 * without talking to Expo.
 */
export class FakePushService {
  readonly sent: SentPush[] = [];

  sendToUser(userId: string, payload: PushPayload): Promise<void> {
    this.sent.push({ userId, payload });
    return Promise.resolve();
  }

  /** Notification types delivered to one user, in order. */
  typesFor(userId: string): string[] {
    return this.sent
      .filter((push) => push.userId === userId)
      .map((push) => push.payload.data?.['type'] ?? '');
  }

  reset(): void {
    this.sent.length = 0;
  }
}
