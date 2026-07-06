-- F-053 + F-052: dedupe pre-existing rows, then add the concurrency-guarding
-- unique constraints. Each dedupe keeps the MOST-RECENT row per group and
-- removes the older duplicates; every DELETE is scoped and commented.

-- ─────────────────────────────────────────────────────────────────────────────
-- F-053: at most one ACTIVE enrollment per (user_id, course_id).
--
-- "Active" = the in-flight statuses a live enrollment can hold:
--   enrolled, assigned, in_progress, lessons_complete.
-- Terminal/historical statuses (completed, attested, locked, failed,
-- retry_requested) are deliberately EXCLUDED so that a retake — a new
-- enrollment created while the previous attempt stays completed/failed —
-- does not collide with its own history.
--
-- Recency key: enrollments have no created_at column, so "most recent" is
-- ordered by started_at DESC, then id DESC as a deterministic tie-breaker.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  removed_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "user_id", "course_id"
        ORDER BY "started_at" DESC, "id" DESC
      ) AS rn
    FROM "enrollments"
    WHERE "status" IN ('enrolled', 'assigned', 'in_progress', 'lessons_complete')
  ),
  deleted AS (
    DELETE FROM "enrollments" e
    USING ranked
    WHERE e."id" = ranked."id"
      AND ranked.rn > 1
    RETURNING e."id"
  )
  SELECT count(*) INTO removed_count FROM deleted;
  RAISE NOTICE 'F-053: removed % duplicate active enrollment row(s)', removed_count;
END $$;

-- Partial unique index enforcing single-active-enrollment. Filtered/partial
-- uniques are not expressible in Prisma, so this lives only at the DB level
-- (documented in prisma/enrollment.prisma).
CREATE UNIQUE INDEX "enrollments_user_id_course_id_active_key"
  ON "enrollments"("user_id", "course_id")
  WHERE "status" IN ('enrolled', 'assigned', 'in_progress', 'lessons_complete');

-- ─────────────────────────────────────────────────────────────────────────────
-- F-052: category slug becomes unique PER ORGANIZATION instead of globally.
--
-- NOTE: `slug` is currently globally UNIQUE (course_categories_slug_key), so no
-- duplicate (organization_id, slug) pairs can exist yet — the dedupe below is a
-- defensive no-op today, but kept correct in case this ever runs against a DB
-- where the global unique was already dropped out-of-band.
--
-- Before deleting a duplicate category we REPOINT its dependents onto the kept
-- (most-recent) row so we never silently orphan data:
--   • courses.category_id                  (FK ON DELETE SET NULL)
--   • manual_chunk_categories.category_id  (FK ON DELETE CASCADE)
-- Recency key: created_at DESC, then id DESC as a deterministic tie-breaker.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  removed_count INTEGER;
BEGIN
  -- Map every duplicate category id → the id of the most-recent row it collides with.
  CREATE TEMP TABLE _category_dupes ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      "id",
      "organization_id",
      "slug",
      first_value("id") OVER (
        PARTITION BY "organization_id", "slug"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS keep_id,
      ROW_NUMBER() OVER (
        PARTITION BY "organization_id", "slug"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS rn
    FROM "course_categories"
  )
  SELECT "id" AS dup_id, keep_id
  FROM ranked
  WHERE rn > 1;

  -- Repoint courses off the duplicate categories onto the kept row.
  UPDATE "courses" c
  SET "category_id" = d.keep_id
  FROM _category_dupes d
  WHERE c."category_id" = d.dup_id;

  -- Repoint manual-chunk mappings, skipping any that would violate the
  -- (chunk_id, category_id) primary key on the kept row (chunk already mapped).
  UPDATE "manual_chunk_categories" m
  SET "category_id" = d.keep_id
  FROM _category_dupes d
  WHERE m."category_id" = d.dup_id
    AND NOT EXISTS (
      SELECT 1 FROM "manual_chunk_categories" x
      WHERE x."chunk_id" = m."chunk_id"
        AND x."category_id" = d.keep_id
    );
  -- Any mappings left on a duplicate category are true duplicates of a kept
  -- mapping; they are removed by the CASCADE when the duplicate category is deleted.

  WITH deleted AS (
    DELETE FROM "course_categories" c
    USING _category_dupes d
    WHERE c."id" = d.dup_id
    RETURNING c."id"
  )
  SELECT count(*) INTO removed_count FROM deleted;
  RAISE NOTICE 'F-052: removed % duplicate (organization_id, slug) category row(s)', removed_count;
END $$;

-- Drop the old global unique on slug.
-- DropIndex
DROP INDEX "course_categories_slug_key";

-- Add the org-scoped composite unique (expressed in prisma/category.prisma).
-- CreateIndex
CREATE UNIQUE INDEX "course_categories_organization_id_slug_key"
  ON "course_categories"("organization_id", "slug");

-- Preserve GLOBAL slug uniqueness for SYSTEM categories: the composite above
-- treats NULL organization_id as distinct, so it would allow two system
-- categories to share a slug. This partial unique closes that gap. It is not
-- expressible in Prisma (documented in prisma/category.prisma).
-- CreateIndex
CREATE UNIQUE INDEX "course_categories_system_slug_key"
  ON "course_categories"("slug")
  WHERE "organization_id" IS NULL;
