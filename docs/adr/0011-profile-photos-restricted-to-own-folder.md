# 0011. Profile photos restricted to the user's storage folder

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Profile photos are uploaded by the client straight to Supabase Storage
([ADR 0002](0002-nestjs-api-owns-data-access.md)), and the resulting URL is
saved with `PATCH /v1/users/me`. The API accepted any URL. A profile could
therefore embed a third-party image that every viewer's app fetches, such as
a tracking pixel that leaks their IP address, or point at another user's
photo.

## Decision

- Photos live in the public bucket `avatars` (`AVATAR_BUCKET` in
  `@gigmap/shared`), at `<user id>/<file name>`.
- Storage policies let a user write only inside their own folder (setup SQL
  in [supabase-setup.md](../supabase-setup.md)).
- The API accepts a `photoUrl` only if it has the project's Supabase origin
  and a path under `/storage/v1/object/public/avatars/<own user id>/`.
  Anything else is a 422 on `photoUrl`. `null` clears the photo.

## Consequences

- Clients must upload first, then save the public URL. Query strings (e.g. a
  cache-busting `?t=`) are allowed.
- Images served through Supabase's transformation endpoint
  (`/storage/v1/render/image/...`) are not accepted as-is. Store the object
  URL and let the client request transforms.
- Changing the bucket name or folder convention is a breaking change for
  stored URLs.
