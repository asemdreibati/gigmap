# Supabase setup

Supabase provides auth, storage and the Postgres database. The API owns all
data access ([ADR 0002](adr/0002-nestjs-api-owns-data-access.md)), so
there is little to configure, but a few settings matter.

## 1. Create the project

- **Region: EU Central (Frankfurt).** It cannot be changed later, and it
  determines where Swiss users' data lives (nFADP/GDPR).
- Postgres 16 or later. PostGIS is enabled by the first migration
  (`CREATE EXTENSION IF NOT EXISTS postgis`).

Copy into `.env` (see [.env.example](../.env.example)):

- **Project URL** → `SUPABASE_URL`
- **Connection strings** (Connect → ORMs → Prisma): transaction pooler →
  `DATABASE_URL`, session pooler → `DIRECT_URL`. Pool sizing is in
  [deployment.md](deployment.md#database-pool-sizing).
- **API keys**: anon → `SUPABASE_ANON_KEY`, for the clients only. The API
  needs no Supabase key; it verifies tokens against the project's public
  JWKS. Nothing in GigMap needs the service-role key, so keep it out of
  every environment.

Then apply the schema: `pnpm db:deploy`.

## 2. Auth

- **Sign-in method:** email + password. Leave "Confirm email" on.
- **Redirect URLs:** add the web origin and the Expo app's scheme so
  confirmation and password-reset links return to the app.
- **JWT signing keys:** new projects sign access tokens with asymmetric keys,
  and the API verifies them against
  `SUPABASE_URL/auth/v1/.well-known/jwks.json`. Leave `SUPABASE_JWT_SECRET`
  empty. Only projects still on the legacy shared secret set it.

The API checks issuer (`SUPABASE_URL/auth/v1`) and audience
(`authenticated`). After sign-up, the client must call `POST /v1/users/me`
to pick a role. Every other route returns 403 until it has.

## 3. Storage: profile photos

Create a public `avatars` bucket where each user can write only inside a
folder named after their user id
([ADR 0011](adr/0011-profile-photos-restricted-to-own-folder.md)). Run in
the SQL editor:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Uploads, replacements (upsert needs select + update) and deletes are
-- limited to `avatars/<own user id>/…`. Reads need no policy: the bucket is public.
create policy "avatars: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: replace in own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete from own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

Client flow:

1. Upload to `avatars/<user id>/<file name>` with `supabase-js`.
2. Get the public URL (`getPublicUrl`).
3. Save it with `PATCH /v1/users/me { "photoUrl": "…" }`. The API rejects
   URLs outside that folder with 422.

## 4. Database access from outside the API

RLS is enabled on every table with no policies, so the anon and
authenticated roles can read nothing through PostgREST. That is intended.
Do not add policies to make a client query work; add an API endpoint.

Admin work in v1, such as acting on reports or deactivating users
(`users.is_active = false`), is done in Supabase Studio. Deactivated users
get 403 on every request and disappear from public profiles and the map.
