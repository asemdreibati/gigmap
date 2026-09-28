import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@gigmap/shared';

import type { AuthenticatedUser } from '../guards/authenticated-user';

export const IS_PUBLIC_KEY = 'gigmap:isPublic';
export const ALLOW_NO_PROFILE_KEY = 'gigmap:allowNoProfile';
export const ROLES_KEY = 'gigmap:roles';

/** No token required at all. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires a valid Supabase token but tolerates the user having no row in
 * `users` yet. Only the profile-bootstrap endpoint should use this — every
 * other route needs a role to authorise against.
 */
export const AllowNoProfile = () => SetMetadata(ALLOW_NO_PROFILE_KEY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return field ? request.user[field] : request.user;
  },
);
