import type { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env';
import { PushService, RECEIPT_DELAY_MS, RECEIPT_TTL_MS } from './push.service';

const LIVE = 'ExponentPushToken[live-device]';
const GONE = 'ExponentPushToken[uninstalled]';

describe('PushService', () => {
  let prisma: {
    pushToken: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let send: jest.SpyInstance;
  let fetchReceipts: jest.SpyInstance;
  let push: PushService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-01T12:00:00Z') });

    prisma = {
      pushToken: {
        findMany: jest.fn().mockResolvedValue([{ token: LIVE }, { token: GONE }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const config = { get: () => undefined } as unknown as ConfigService<Env, true>;

    send = jest.spyOn(Expo.prototype, 'sendPushNotificationsAsync').mockResolvedValue([
      { status: 'ok', id: 'ticket-live' },
      { status: 'ok', id: 'ticket-gone' },
    ] satisfies ExpoPushTicket[]);
    fetchReceipts = jest
      .spyOn(Expo.prototype, 'getPushNotificationReceiptsAsync')
      .mockResolvedValue({
        'ticket-live': { status: 'ok' },
        'ticket-gone': {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
      } satisfies Record<string, ExpoPushReceipt>);

    push = new PushService(prisma as unknown as PrismaService, config);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const sendOne = () => push.sendToUser('user-1', { title: 'Hi', body: 'There' });

  it('prunes tokens Expo rejects outright on the ticket', async () => {
    send.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-live' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ] satisfies ExpoPushTicket[]);

    await sendOne();

    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: [GONE] } },
    });
  });

  it('waits before asking for receipts', async () => {
    await sendOne();
    jest.advanceTimersByTime(RECEIPT_DELAY_MS - 1000);

    await push.checkReceipts();

    expect(fetchReceipts).not.toHaveBeenCalled();
  });

  it('prunes tokens whose receipt says the device is gone, and checks each ticket once', async () => {
    await sendOne();
    jest.advanceTimersByTime(RECEIPT_DELAY_MS);

    await push.checkReceipts();

    expect(fetchReceipts).toHaveBeenCalledWith(['ticket-live', 'ticket-gone']);
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: [GONE] } },
    });

    await push.checkReceipts();
    expect(fetchReceipts).toHaveBeenCalledTimes(1);
  });

  it('retries receipts Expo has not produced yet, until they expire', async () => {
    fetchReceipts.mockResolvedValue({});
    await sendOne();

    jest.advanceTimersByTime(RECEIPT_DELAY_MS);
    await push.checkReceipts();
    jest.advanceTimersByTime(RECEIPT_DELAY_MS);
    await push.checkReceipts();
    expect(fetchReceipts).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(RECEIPT_TTL_MS);
    await push.checkReceipts();
    expect(fetchReceipts).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when Expo is down', async () => {
    send.mockRejectedValueOnce(new Error('503'));

    await expect(sendOne()).resolves.toBeUndefined();
  });
});
