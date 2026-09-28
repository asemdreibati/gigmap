import type { UserRole } from '@gigmap/shared';

/** Attached to every authenticated request by `SupabaseAuthGuard`. */
export interface AuthenticatedUser {
  /** Supabase auth user id. Also the primary key of our `users` row. */
  id: string;
  email: string;
  /** Null only on the profile-bootstrap route, before a role has been chosen. */
  role: UserRole | null;
  hasProfile: boolean;
}
