import { minutes, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../common/guards/authenticated-user';

/**
 * Per-user request budgets. The guard runs after authentication, so limits
 * follow the account rather than the IP — mobile users share carrier NAT
 * addresses, and a per-IP limit would throttle strangers together.
 *
 * Unauthenticated floods are rejected by token verification before any
 * database work, and belong to the edge (load balancer / WAF) anyway.
 * See ADR 0009.
 */
export const RATE_LIMITS = {
  /** Any authenticated route. Generous: the map refetches as users pan. */
  default: { limit: 120, ttl: minutes(1) },
  /** Each report emails the admin. */
  reports: { limit: 10, ttl: minutes(60) },
  /** Each posting shows up on every nearby worker's map. */
  postJob: { limit: 20, ttl: minutes(60) },
  /** Each application pushes a notification to an employer. */
  apply: { limit: 60, ttl: minutes(60) },
} as const;

export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ...RATE_LIMITS.default }],
  errorMessage: 'Too many requests. Please wait a moment and try again.',
  getTracker: (req: Record<string, unknown>) => {
    const { user, ip } = req as unknown as Request & { user?: AuthenticatedUser };
    return user?.id ?? ip ?? 'unknown';
  },
};
