import { AVATAR_BUCKET } from '@gigmap/shared';

/**
 * Whether `photoUrl` points into the user's own folder of the avatars bucket
 * in this project's Supabase Storage.
 *
 * Anything else would let a profile embed an arbitrary third-party URL —
 * a tracking pixel every viewer's app fetches, or someone else's photo.
 */
export function isOwnAvatarUrl(photoUrl: string, supabaseUrl: string, userId: string): boolean {
  let url: URL;
  try {
    url = new URL(photoUrl);
  } catch {
    return false;
  }

  // WHATWG URL parsing has already resolved `..` (including `%2e%2e`), so a
  // prefix check on the pathname cannot be escaped with path traversal.
  const folder = `/storage/v1/object/public/${AVATAR_BUCKET}/${userId}/`;

  return (
    url.origin === new URL(supabaseUrl).origin &&
    url.pathname.startsWith(folder) &&
    url.pathname.length > folder.length
  );
}
