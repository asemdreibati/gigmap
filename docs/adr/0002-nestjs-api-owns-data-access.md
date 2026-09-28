# 0002. A NestJS API owns data access; Supabase provides auth and storage

- **Status:** Accepted (recorded retroactively)
- **Date:** 2026-08-12

## Context

The PRD has the mobile and web clients talk to Supabase directly, with
row-level security (RLS) as the authorisation layer, Edge Functions for
server logic and pg_cron for scheduled work.

The business rules do not fit that shape:

- Accepting an applicant must lock the job and keep `filled_slots` in step
  with the applications ([ADR 0005](0005-row-locks-for-job-state-changes.md)).
- Rating eligibility spans three tables: an accepted application must link
  the two users on a job that has started.
- Accepting, closing and expiring jobs fan out push notifications.

Split across RLS policies, PL/pgSQL and Deno functions, each rule would live
in a different language with a different test story. The PRD's own "public
read" policy on `users` also exposed everyone's email and phone number to
anyone holding the anon key.

## Decision

- **Supabase Auth** stays the identity provider. Clients use `supabase-js`
  to sign in and get an access token.
- **Supabase Storage** holds uploaded files. Clients upload directly
  ([ADR 0011](0011-profile-photos-restricted-to-own-folder.md)).
- **Everything else goes through the NestJS API** (`apps/api`). Clients
  never call `.from()`. The API verifies the Supabase access token, maps it
  to a `users` row, and authorises in the service layer.
- **RLS is enabled on every table with no permissive policies.** The API
  connects as the table owner and bypasses it; a leaked anon key reads
  nothing through PostgREST. This is defence in depth, not the primary
  control.

## Alternatives considered

- **Supabase-direct as in the PRD.** Rejected for the reasons above.
- **Hand-rolled auth in the API.** Email verification, password reset,
  refresh-token rotation and secure token storage on mobile are weeks of
  work and the highest-consequence place for a subtle bug.

## Consequences

- One language and one test suite for all business logic.
- The API is a service to deploy and operate (see
  [deployment.md](../deployment.md)); the PRD's architecture had none.
- Supabase features that assume direct table access (Realtime on tables,
  auto-generated REST) are not used. Realtime would need to be re-introduced
  deliberately, e.g. via broadcast channels driven by the API.
