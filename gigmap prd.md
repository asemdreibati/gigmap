# GigMap — Product Requirements Document

> Uber-style job board · Solo dev · 3.5 months · Mobile (iOS + Android) + Web

---

## 1. Project Overview

**Concept:** A user opens the app when they have free time, sees a live map of available short-term jobs near them, and applies with one tap. Employers post jobs that appear instantly on the map.

**Users:**

- **Worker** — finds and applies to jobs near their current location
- **Employer** — posts jobs with a map pin, manages applicants

---

## 2. Tech Stack

| Layer              | Technology                                | Notes                             |
| ------------------ | ----------------------------------------- | --------------------------------- |
| Mobile             | React Native + Expo                       | iOS + Android from one codebase   |
| Web                | Next.js 14 (App Router)                   | Shares same Supabase backend      |
| Database           | Supabase (PostgreSQL + PostGIS)           | Geo-radius queries via ST_DWithin |
| Auth               | Supabase Auth                             | Email/password + JWT              |
| Maps               | Mapbox GL JS / react-native-maps + Mapbox | 50k free loads/month              |
| Push Notifications | Expo Notifications + Firebase FCM         | iOS + Android                     |
| File Storage       | Supabase Storage                          | Profile photos, logos             |
| Web Hosting        | Vercel                                    | Auto-deploy from GitHub           |
| Email              | Resend                                    | Transactional emails              |
| Payments           | **Phase 2 only** — Stripe Connect         | Not in v1                         |

---

## 3. Database Schema

```sql
-- Enable PostGIS
create extension if not exists postgis;

-- USERS (shared between workers and employers)
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text check (role in ('worker', 'employer')) not null,
  name text not null,
  photo_url text,
  phone text,
  bio text,
  avg_rating numeric(2,1) default 0,
  rating_count int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- WORKER PROFILES
create table worker_profiles (
  id uuid primary key references users(id) on delete cascade,
  skills text[] default '{}',       -- e.g. ['delivery', 'hospitality']
  experience_years int default 0
);

-- EMPLOYER PROFILES
create table employer_profiles (
  id uuid primary key references users(id) on delete cascade,
  company_name text,
  website text
);

-- JOBS
create table jobs (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid references users(id) on delete cascade not null,
  title text not null,
  description text not null,
  category text check (category in (
    'delivery', 'hospitality', 'events', 'cleaning',
    'warehouse', 'retail', 'admin', 'construction', 'other'
  )) not null,
  pay_amount numeric(10,2) not null,
  pay_type text check (pay_type in ('hourly', 'fixed')) not null,
  slots int default 1,                        -- number of workers needed
  location geography(Point, 4326) not null,   -- PostGIS point (lng, lat)
  address text not null,                       -- human-readable address
  start_time timestamptz not null,
  duration_hours numeric(4,1),
  status text check (status in ('open', 'filled', 'expired', 'cancelled')) default 'open',
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '7 days'
);

-- Geo index for fast radius queries
create index jobs_location_idx on jobs using gist(location);
create index jobs_status_idx on jobs(status);

-- APPLICATIONS
create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  worker_id uuid references users(id) on delete cascade not null,
  status text check (status in ('pending', 'accepted', 'rejected')) default 'pending',
  created_at timestamptz default now(),
  unique(job_id, worker_id)           -- one application per job per worker
);

-- RATINGS
create table ratings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  rater_id uuid references users(id) not null,
  rated_id uuid references users(id) not null,
  stars int check (stars between 1 and 5) not null,
  created_at timestamptz default now(),
  unique(job_id, rater_id)            -- one rating per job per rater
);

-- REPORTS
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references users(id) not null,
  target_type text check (target_type in ('job', 'user')) not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz default now()
);
```

---

## 4. API / Supabase RPC Functions

```sql
-- Get jobs within radius (core geo-search)
create or replace function get_jobs_nearby(
  lat float,
  lng float,
  radius_km float default 10,
  category_filter text default null
)
returns table (
  id uuid, title text, description text, category text,
  pay_amount numeric, pay_type text, address text,
  distance_km float, start_time timestamptz, duration_hours numeric,
  slots int, employer_id uuid, employer_name text, employer_rating numeric
)
language sql stable as $$
  select
    j.id, j.title, j.description, j.category,
    j.pay_amount, j.pay_type, j.address,
    round((st_distance(j.location::geography,
      st_point(lng, lat)::geography) / 1000)::numeric, 2) as distance_km,
    j.start_time, j.duration_hours, j.slots,
    j.employer_id, u.name as employer_name, u.avg_rating as employer_rating
  from jobs j
  join users u on u.id = j.employer_id
  where
    j.status = 'open'
    and j.expires_at > now()
    and st_dwithin(j.location::geography, st_point(lng, lat)::geography, radius_km * 1000)
    and (category_filter is null or j.category = category_filter)
  order by distance_km asc;
$$;
```

---

## 5. Feature List & Scope

### ✅ BUILD — Must have at launch

#### Auth & Onboarding

- [ ] Email + password sign-up / login (Supabase Auth)
- [ ] Role selection on first login: Worker or Employer
- [ ] Auto-create worker_profile or employer_profile row on signup

#### Worker — Map & Discovery

- [ ] Full-screen Mapbox map centered on user's GPS location
- [ ] Job pins rendered for all open jobs within radius
- [ ] Tap a pin → bottom sheet with job details
- [ ] Radius slider (1–30 km), updates map in real time
- [ ] Category filter chips (horizontal scroll)
- [ ] Toggle: Map view ↔ List view (same data, different presentation)

#### Worker — Applying

- [ ] "Apply" button on job detail sheet
- [ ] One insert into `applications` table
- [ ] Employer receives push notification on new application
- [ ] "My Applications" screen — list with status badges (Pending / Accepted / Rejected)

#### Worker — Profile

- [ ] Edit name, photo (upload to Supabase Storage), phone, bio
- [ ] Skills multi-select (tags from predefined list)
- [ ] Show avg_rating and rating_count on profile

#### Employer — Posting

- [ ] "Post a Job" form: title, description, category, pay, start time, duration, slots
- [ ] Tap map to place location pin (or search address with Mapbox Geocoding API)
- [ ] Submit → job appears on map immediately

#### Employer — Managing

- [ ] "My Jobs" screen — list of posted jobs with status
- [ ] Tap job → see applicants list (name, photo, rating, applied_at)
- [ ] Accept / Reject applicant → push notification sent to worker
- [ ] Mark job as Filled / Cancel job

#### Ratings

- [ ] After job start_time passes + accepted: both sides can rate (1–5 stars)
- [ ] Rating updates avg_rating via DB trigger or Edge Function

#### Trust & Safety

- [ ] Report button on every job and user profile
- [ ] Insert into reports table → send email to admin via Resend

#### Web App (Next.js)

- [ ] Same auth, same Supabase backend
- [ ] Employer-focused: post jobs, manage applicants (desktop-friendly)
- [ ] Worker-focused: map view works in browser (Mapbox GL JS)

---

### 🔜 LATER — Phase 2 (after launch & first revenue)

- [ ] Stripe Connect payments + pre-auth + auto-release
- [ ] GPS check-in / check-out (needed for payment trigger)
- [ ] In-app messaging (Socket.io or Supabase Realtime)
- [ ] Written text reviews alongside stars
- [ ] Saved / bookmarked jobs
- [ ] Multi-language (DE, FR, IT for Switzerland)
- [ ] AI job recommendations
- [ ] Custom admin dashboard (until then: use Supabase Studio)

---

### ❌ SKIP — Out of scope for v1

- Phone OTP / social login (Google, Apple)
- ID verification (Onfido, Sumsub)
- Turn-by-turn navigation (deep-link to Google Maps instead)
- Job approval queue (auto-publish, report button handles abuse)
- Revenue / commission dashboard (no payments in v1)
- Background checks
- Referral / loyalty program

---

## 6. Screens & Navigation

### Mobile (React Native + Expo)

```
App
├── Auth Stack
│   ├── WelcomeScreen
│   ├── LoginScreen
│   ├── SignupScreen
│   └── RoleSelectScreen
│
├── Worker Tab Navigator
│   ├── MapScreen (default tab)          ← full-screen map + filter bar
│   ├── ApplicationsScreen               ← my applications list
│   └── ProfileScreen                    ← edit profile
│
└── Employer Tab Navigator
    ├── MyJobsScreen (default tab)        ← posted jobs list
    ├── PostJobScreen                     ← create job form + map pin
    └── ProfileScreen                     ← edit employer profile
```

**Shared screens (stack pushed on top):**

- `JobDetailSheet` — bottom sheet, shown when map pin tapped
- `ApplicantsScreen` — shown when employer taps a job
- `WorkerProfileScreen` — shown when employer taps an applicant
- `RatingScreen` — shown after job completion
- `ReportScreen` — flag job or user

---

### Web (Next.js App Router)

```
/                   → Landing page (sign in / sign up)
/map                → Worker map view (Mapbox GL JS)
/applications       → Worker: my applications
/profile            → Worker or employer profile edit
/jobs               → Employer: my jobs list
/jobs/new           → Employer: post a job
/jobs/[id]          → Employer: job detail + applicants
```

---

## 7. Key Components to Build

```
components/
├── map/
│   ├── JobMap.tsx              -- Mapbox map, renders job pins
│   ├── JobPin.tsx              -- custom map marker
│   ├── RadiusSlider.tsx        -- distance filter
│   └── CategoryFilter.tsx      -- horizontal chip list
├── jobs/
│   ├── JobDetailSheet.tsx      -- bottom sheet on pin tap
│   ├── JobCard.tsx             -- list view card
│   ├── JobForm.tsx             -- post/edit job form
│   └── ApplicantRow.tsx        -- single applicant in list
├── profile/
│   ├── AvatarUpload.tsx        -- photo upload to Supabase Storage
│   ├── SkillsSelect.tsx        -- multi-select skill tags
│   └── RatingStars.tsx         -- display + input stars
└── shared/
    ├── BottomSheet.tsx          -- reusable slide-up sheet
    ├── StatusBadge.tsx          -- pending/accepted/rejected pill
    └── EmptyState.tsx           -- empty list illustration + CTA
```

---

## 8. Supabase Row Level Security (RLS)

```sql
-- Users can read all profiles, only edit their own
alter table users enable row level security;
create policy "public read" on users for select using (true);
create policy "own update" on users for update using (auth.uid() = id);

-- Jobs: anyone can read open jobs, only employer can edit theirs
alter table jobs enable row level security;
create policy "public read open jobs" on jobs for select using (status = 'open');
create policy "employer insert" on jobs for insert with check (auth.uid() = employer_id);
create policy "employer update" on jobs for update using (auth.uid() = employer_id);

-- Applications: worker sees own, employer sees for their jobs
alter table applications enable row level security;
create policy "worker sees own" on applications for select using (auth.uid() = worker_id);
create policy "employer sees for job" on applications for select using (
  exists (select 1 from jobs where id = job_id and employer_id = auth.uid())
);
create policy "worker applies" on applications for insert with check (auth.uid() = worker_id);
create policy "employer updates status" on applications for update using (
  exists (select 1 from jobs where id = job_id and employer_id = auth.uid())
);

-- Ratings: readable by all, writable only after job
alter table ratings enable row level security;
create policy "public read" on ratings for select using (true);
create policy "rater insert" on ratings for insert with check (auth.uid() = rater_id);
```

---

## 9. Environment Variables

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-side only, never expose to client

# Mapbox
MAPBOX_ACCESS_TOKEN=

# Firebase (push notifications)
FIREBASE_SERVER_KEY=

# Resend (email)
RESEND_API_KEY=

# App
ADMIN_EMAIL=                    # reports get sent here
```

---

## 10. Push Notification Events

| Trigger                      | Recipient | Message                                      |
| ---------------------------- | --------- | -------------------------------------------- |
| Worker applies to job        | Employer  | "New applicant for [Job Title]"              |
| Employer accepts application | Worker    | "You got the job! [Job Title] at [Company]"  |
| Employer rejects application | Worker    | "Update on your application for [Job Title]" |
| Job about to expire (24h)    | Employer  | "Your job [Job Title] expires tomorrow"      |

---

## 11. Folder Structure

```
gigmap/
├── apps/
│   ├── mobile/                 # Expo React Native app
│   │   ├── app/                # Expo Router file-based routing
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   │   ├── supabase.ts
│   │   │   └── notifications.ts
│   │   └── app.json
│   │
│   └── web/                    # Next.js app
│       ├── app/                # App Router
│       ├── components/
│       └── lib/
│           └── supabase.ts
│
├── packages/
│   └── shared/                 # shared types, constants, utils
│       ├── types.ts            # Job, User, Application, Rating interfaces
│       ├── categories.ts       # job category list
│       └── skills.ts           # worker skills list
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial.sql     # schema from section 3
│   └── seed.sql                # dev seed data
│
└── README.md
```

---

## 12. TypeScript Types

```typescript
// packages/shared/types.ts

export type UserRole = 'worker' | 'employer';
export type JobStatus = 'open' | 'filled' | 'expired' | 'cancelled';
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';
export type PayType = 'hourly' | 'fixed';

export type JobCategory =
  | 'delivery'
  | 'hospitality'
  | 'events'
  | 'cleaning'
  | 'warehouse'
  | 'retail'
  | 'admin'
  | 'construction'
  | 'other';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  photo_url?: string;
  phone?: string;
  bio?: string;
  avg_rating: number;
  rating_count: number;
  created_at: string;
}

export interface Job {
  id: string;
  employer_id: string;
  title: string;
  description: string;
  category: JobCategory;
  pay_amount: number;
  pay_type: PayType;
  slots: number;
  address: string;
  latitude: number;
  longitude: number;
  start_time: string;
  duration_hours?: number;
  status: JobStatus;
  created_at: string;
  expires_at: string;
  // joined fields from get_jobs_nearby()
  distance_km?: number;
  employer_name?: string;
  employer_rating?: number;
}

export interface Application {
  id: string;
  job_id: string;
  worker_id: string;
  status: ApplicationStatus;
  created_at: string;
  // joined
  job?: Job;
  worker?: User;
}

export interface Rating {
  id: string;
  job_id: string;
  rater_id: string;
  rated_id: string;
  stars: number;
  created_at: string;
}
```

---

## 13. Development Order (follow this exactly)

1. **Supabase project** — create project, run migration SQL, enable PostGIS, set up Storage bucket (`avatars`)
2. **Shared types package** — define all TypeScript interfaces
3. **Auth flows** — signup, login, role select, session persistence
4. **Jobs API** — `get_jobs_nearby` RPC, CRUD endpoints via Supabase client
5. **Map screen** — Mapbox map + job pins + radius slider + category filter
6. **Job detail sheet** — tap pin → see details → apply button
7. **Applications flow** — apply, status update, employer accept/reject
8. **Push notifications** — wire FCM to application status changes
9. **Employer post job** — form + map pin placement
10. **Profiles** — edit screens, photo upload
11. **Ratings** — post-job rating screen
12. **Report flow** — button → email to admin
13. **Web app (Next.js)** — mirror core flows for browser
14. **Polish** — empty states, error handling, loading skeletons
15. **QA** — real device testing iOS + Android

---

## 14. Known Constraints

- **No payments in v1** — contact info (phone/WhatsApp) shared after acceptance
- **No in-app chat** — Supabase Realtime messaging deferred to phase 2
- **No ID verification** — honour system at launch
- **Admin panel** — use Supabase Studio directly; no custom UI in v1
- **Navigation** — deep-link to Google Maps / Apple Maps instead of in-app routing
- **Switzerland focus** — single timezone (CET/CEST), single currency (CHF) for v1
