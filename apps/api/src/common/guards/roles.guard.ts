import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@gigmap/shared';

import { ROLES_KEY } from '../decorators';
import type { AuthenticatedUser } from './authenticated-user';

/** Enforces `@Roles(...)`. Runs after `SupabaseAuthGuard` has resolved the role. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException(
        `This action is only available to ${required.join(' or ')} accounts`,
      );
    }

    return true;
  }
}
