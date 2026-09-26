-- Backfill enrollments.completed_at (BUG-08). Data only — no schema change.
--
-- No runtime path ever wrote `completed_at`, so every enrollment that reached a
-- terminal completed state carries NULL. The consequences are all on the
-- compliance side: the auditor exports print a blank "Date Completed", the
-- facility dashboard's on-time completion share divides by a numerator that is
-- always 0, and the renewal sweep — which keys the next cycle on
-- `completed_at IS NOT NULL` — renews nothing.
--
-- From this migration forward `attestCourse` stamps `completed_at` in lockstep
-- with `attested_at`. The rows updated below predate that fix, so their value is
-- a RECONSTRUCTION, not a recorded observation. Sources, in order of preference:
--
--   1. `attested_at` — EXACT, not a guess. Attestation is the completion act, so
--      for every `attested` row this reproduces precisely what the fixed code
--      now writes. This covers essentially the whole population.
--   2. The most recent PASSING quiz attempt's `completed_at` — a PROXY, and it
--      dates the assessment rather than the (missing) attestation. Used only for
--      legacy `completed` rows: a status no code in src/ writes any more, held
--      by learners who passed before attestation existed and were never asked to
--      sign, so no `attested_at` exists to prefer. "Passing" is
--      `quiz_attempts.score >= quizzes.passing_score` against the quiz's CURRENT
--      bar.
--   3. The most recent completed quiz attempt of any score — last resort for a
--      row that reached a completed status with no attempt clearing today's bar
--      (the passing score may have been raised since it was taken).
--
-- `started_at` is deliberately NOT a fallback: it is stamped at ENROLLMENT
-- creation, so it dates the ASSIGNMENT, not the completion — a completion date
-- equal to the assignment date would read as an instant completion and is worse
-- than a blank cell. (`enrollments` has no `updated_at` column, so that fallback
-- does not exist here either.) A completed row with no attestation and no
-- completed quiz attempt therefore keeps NULL and still exports as "—".
--
-- Only NULL values on terminal statuses are touched: no recorded timestamp is
-- overwritten, and no non-terminal row is given a completion date.
UPDATE "enrollments" e
SET "completed_at" = d."derived"
FROM (
  SELECT
    e2."id",
    COALESCE(
      e2."attested_at",
      (
        SELECT MAX(qa."completed_at")
        FROM "quiz_attempts" qa
        JOIN "quizzes" q ON q."id" = qa."quiz_id"
        WHERE qa."enrollment_id" = e2."id"
          AND qa."time_taken" IS NOT NULL
          AND qa."score" >= q."passing_score"
      ),
      (
        SELECT MAX(qa."completed_at")
        FROM "quiz_attempts" qa
        WHERE qa."enrollment_id" = e2."id"
          AND qa."time_taken" IS NOT NULL
      )
    ) AS "derived"
  FROM "enrollments" e2
  WHERE e2."completed_at" IS NULL
    AND e2."status" IN ('completed', 'attested')
) d
WHERE d."id" = e."id"
  -- Only rows a date can actually be derived for. Without this the statement
  -- re-matches every evidence-less row on each run and writes NULL over NULL:
  -- harmless to the data, but it rewrites those rows every time and makes the
  -- migration's "re-running changes nothing" promise false. Verified: the
  -- unguarded form reported UPDATE 1 on a second run against the same fixtures.
  AND d."derived" IS NOT NULL;
