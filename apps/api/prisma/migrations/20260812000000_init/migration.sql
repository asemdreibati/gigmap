-- GigMap initial schema.
--
-- Hand-written rather than generated, because Prisma cannot express the
-- PostGIS extension, the geography column, the GiST index or the triggers.
-- Everything else matches `schema.prisma` exactly.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "UserRole" AS ENUM ('worker', 'employer');
CREATE TYPE "JobStatus" AS ENUM ('open', 'filled', 'expired', 'cancelled');
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE "PayType" AS ENUM ('hourly', 'fixed');
CREATE TYPE "JobCategory" AS ENUM ('delivery', 'hospitality', 'events', 'cleaning', 'warehouse', 'retail', 'admin', 'construction', 'other');
CREATE TYPE "ReportTargetType" AS ENUM ('job', 'user');
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android', 'web');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE "users" (
    "id"           UUID NOT NULL,
    "email"        TEXT NOT NULL,
    "role"         "UserRole" NOT NULL,
    "name"         TEXT NOT NULL,
    "photo_url"    TEXT,
    "phone"        TEXT,
    "bio"          TEXT,
    "avg_rating"   DECIMAL(2,1) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "worker_profiles" (
    "id"               UUID NOT NULL,
    "skills"           TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience_years" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employer_profiles" (
    "id"           UUID NOT NULL,
    "company_name" TEXT,
    "website"      TEXT,

    CONSTRAINT "employer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
    "id"             UUID NOT NULL,
    "employer_id"    UUID NOT NULL,
    "title"          TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "category"       "JobCategory" NOT NULL,
    "pay_amount"     DECIMAL(10,2) NOT NULL,
    "pay_type"       "PayType" NOT NULL,
    "slots"          INTEGER NOT NULL DEFAULT 1,
    "filled_slots"   INTEGER NOT NULL DEFAULT 0,
    "latitude"       DOUBLE PRECISION NOT NULL,
    "longitude"      DOUBLE PRECISION NOT NULL,
    "location"       geography(Point, 4326),
    "address"        TEXT NOT NULL,
    "start_time"     TIMESTAMPTZ(6) NOT NULL,
    "duration_hours" DECIMAL(4,1),
    "status"         "JobStatus" NOT NULL DEFAULT 'open',
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id"),
    -- Accepted applications can never exceed the advertised headcount.
    -- The accept transaction relies on this as its last line of defence.
    CONSTRAINT "jobs_filled_slots_check" CHECK ("filled_slots" >= 0 AND "filled_slots" <= "slots")
);
CREATE INDEX "jobs_status_idx" ON "jobs"("status");
CREATE INDEX "jobs_employer_id_idx" ON "jobs"("employer_id");
CREATE INDEX "jobs_expires_at_idx" ON "jobs"("expires_at");

CREATE TABLE "applications" (
    "id"         UUID NOT NULL,
    "job_id"     UUID NOT NULL,
    "worker_id"  UUID NOT NULL,
    "status"     "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "applications_job_id_worker_id_key" ON "applications"("job_id", "worker_id");
CREATE INDEX "applications_worker_id_status_idx" ON "applications"("worker_id", "status");

CREATE TABLE "ratings" (
    "id"         UUID NOT NULL,
    "job_id"     UUID NOT NULL,
    "rater_id"   UUID NOT NULL,
    "rated_id"   UUID NOT NULL,
    "stars"      INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5),
    CONSTRAINT "ratings_no_self_check" CHECK ("rater_id" <> "rated_id")
);
-- One rating per (job, rater, rated) — not per (job, rater): a job with several
-- slots has several hires, and the employer must be able to rate each of them.
CREATE UNIQUE INDEX "ratings_job_id_rater_id_rated_id_key" ON "ratings"("job_id", "rater_id", "rated_id");
CREATE INDEX "ratings_rated_id_idx" ON "ratings"("rated_id");

CREATE TABLE "reports" (
    "id"          UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id"   UUID NOT NULL,
    "reason"      TEXT NOT NULL,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

CREATE TABLE "push_tokens" (
    "token"      TEXT NOT NULL,
    "user_id"    UUID NOT NULL,
    "platform"   "PushPlatform" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("token")
);
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "worker_profiles"   ADD CONSTRAINT "worker_profiles_id_fkey"        FOREIGN KEY ("id")          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employer_profiles" ADD CONSTRAINT "employer_profiles_id_fkey"      FOREIGN KEY ("id")          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs"              ADD CONSTRAINT "jobs_employer_id_fkey"          FOREIGN KEY ("employer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications"      ADD CONSTRAINT "applications_job_id_fkey"       FOREIGN KEY ("job_id")      REFERENCES "jobs"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications"      ADD CONSTRAINT "applications_worker_id_fkey"    FOREIGN KEY ("worker_id")   REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ratings"           ADD CONSTRAINT "ratings_job_id_fkey"            FOREIGN KEY ("job_id")      REFERENCES "jobs"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ratings"           ADD CONSTRAINT "ratings_rater_id_fkey"          FOREIGN KEY ("rater_id")    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ratings"           ADD CONSTRAINT "ratings_rated_id_fkey"          FOREIGN KEY ("rated_id")    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports"           ADD CONSTRAINT "reports_reporter_id_fkey"       FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_tokens"       ADD CONSTRAINT "push_tokens_user_id_fkey"       FOREIGN KEY ("user_id")     REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PostGIS: keep `location` in step with latitude/longitude
--
-- Application code writes lat/lng only (Prisma cannot bind a geography value).
-- The trigger derives the point, so the GiST index below is always accurate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jobs_sync_location() RETURNS TRIGGER AS $$
BEGIN
  NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_sync_location_trg
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION jobs_sync_location();

CREATE INDEX "jobs_location_idx" ON "jobs" USING GIST ("location");

-- Covers the hot path of the map query: open, unexpired jobs only.
CREATE INDEX "jobs_open_location_idx" ON "jobs" USING GIST ("location") WHERE "status" = 'open';

-- ---------------------------------------------------------------------------
-- Ratings: maintain the denormalised average on `users`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ratings_refresh_avg() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "users" u
  SET "avg_rating" = COALESCE(agg.avg_stars, 0),
      "rating_count" = COALESCE(agg.cnt, 0)
  FROM (
    SELECT ROUND(AVG("stars")::numeric, 1) AS avg_stars,
           COUNT(*)::int                   AS cnt
    FROM "ratings"
    WHERE "rated_id" = NEW."rated_id"
  ) agg
  WHERE u."id" = NEW."rated_id";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ratings_refresh_avg_trg
  AFTER INSERT ON "ratings"
  FOR EACH ROW EXECUTE FUNCTION ratings_refresh_avg();

-- ---------------------------------------------------------------------------
-- Defence in depth.
--
-- Authorisation lives in the NestJS service layer; every client request goes
-- through the API using a pooled connection owned by this service. RLS is
-- enabled with no permissive policies so that a leaked anon key exposes
-- nothing via PostgREST. The API's role bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_profiles"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobs"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applications"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ratings"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_tokens"       ENABLE ROW LEVEL SECURITY;
