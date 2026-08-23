/**
 * E2E spec: video-course playback (PR 0–7 — video-playback performance +
 * mobile-correctness overhaul, branch feat/video-course-speed).
 *
 * Covers, against the LIVE app:
 *  - Core playback: the SSR'd `<video>` element (src/app/learn/[id]/page.tsx +
 *    LearnClient), served via the same-origin proxy
 *    (src/app/api/video/[lessonId]/route.ts), Range/206 support, seeking.
 *  - The watch-through gate (src/lib/video/gating.ts,
 *    src/components/video/VideoPlayer.tsx): playing through unlocks the quiz;
 *    a forward scrub past the high-water mark is clamped and does NOT unlock.
 *  - Mobile viewport correctness (src/components/courses/CourseArticle.tsx,
 *    LearnClient.tsx's `h-[100dvh]`): no horizontal overflow, the Previous/Next
 *    nav is reachable, the player sits in an aspect-video box, and only the
 *    ACTIVE lesson's player requests video bytes (preload="none" on the rest).
 *
 * ── Prerequisites, and how this spec differs from the rest of tests/e2e ──
 *
 * Every other spec in this directory seeds through raw SQL alone. This one
 * additionally needs REAL, decodable video bytes behind the seeded lesson's
 * `videoStorageUri` — the proxy route streams from actual object storage, and
 * a `<video>` element cannot report a duration, fire `timeupdate`, or seek
 * against a fake/invalid file. Two things must exist beyond DB + MinIO:
 *
 *   1. tests/e2e/fixtures/sample-lesson.mp4 — a tiny real H.264 clip. Generate
 *      it ONCE with tests/e2e/fixtures/generate-video-fixture.sh (needs
 *      ffmpeg — see that script's header). Commit the output; this spec never
 *      invokes ffmpeg itself.
 *   2. A reachable local MinIO (same env vars the app itself falls back to
 *      when GCS is unconfigured — see quiz-retake-attestation.spec.ts's
 *      identical `isMinioReachable()` rationale). This spec uploads the fixture
 *      directly via the `minio` client package (already a project dependency)
 *      rather than going through the app's own upload/transcode pipeline —
 *      that pipeline is a detached ffmpeg worker (scripts/transcode-worker.ts)
 *      never meant to run inline in a test.
 *
 * Both are probed up front; the whole file self-skips with a clear reason if
 * either is missing, the same pattern quiz-retake-attestation.spec.ts uses for
 * its own MinIO dependency.
 *
 * Pre-conditions otherwise match the rest of the suite:
 *   - App running against the Playwright webServer (localhost:3005).
 *   - DATABASE_URL reachable for direct DB seeding/cleanup.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as Minio from 'minio';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

// Same defaults src/lib/storage/minio-provider.ts falls back to — this spec
// talks to MinIO directly (not through the app), so it must resolve the same
// endpoint/bucket the app itself would in this environment (.env has no
// GCP_BUCKET_NAME configured here, so MinIO is the effective backend).
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = Number(process.env.MINIO_PORT) || 9005;
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'lms_minio_dev';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'lms_minio_secret_dev';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'lms-documents';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-lesson.mp4');
// Must match generate-video-fixture.sh's `-duration=6`.
const FIXTURE_DURATION_SECONDS = 6;

function isMinioReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: MINIO_ENDPOINT, port: MINIO_PORT, timeout: 800 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@video-playback-e2e.invalid`;
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  // Random per-login IP so parallel/sequential runs don't share the
  // credential-layer rate-limit bucket (same convention as
  // course.spec.ts / manage-learn-switcher.spec.ts).
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/worker', { timeout: 30000 });
}

// ── Course-level fixture (shared across tests — the video upload is the
// expensive part). Each test gets its OWN worker + enrollment underneath it
// (see seedLearner/cleanupLearner) so the watch-gate high-water mark from one
// test can never leak into another. ──────────────────────────────────────────

interface CourseFixture {
  orgId: string;
  facilityId: string;
  creatorUserId: string;
  courseId: string;
  lessonAId: string;
  lessonBId: string;
  quizId: string;
  minioObjectKey: string;
}

async function seedCourseFixture(): Promise<CourseFixture> {
  const client = await db();
  try {
    const slug = `video-e2e-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const creatorUserId = crypto.randomUUID();
    const creatorOrgUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const lessonAId = crypto.randomUUID();
    const lessonBId = crypto.randomUUID();
    const quizId = crypto.randomUUID();
    const questionId = crypto.randomUUID();

    const minioObjectKey = `e2e/video-playback/${slug}.mp4`;
    const fixtureBuffer = fs.readFileSync(FIXTURE_PATH);
    const minioClient = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    if (!(await minioClient.bucketExists(MINIO_BUCKET))) {
      await minioClient.makeBucket(MINIO_BUCKET);
    }
    await minioClient.putObject(MINIO_BUCKET, minioObjectKey, fixtureBuffer, fixtureBuffer.length, {
      'Content-Type': 'video/mp4',
    });
    const videoStorageUri = `minio://${MINIO_BUCKET}/${minioObjectKey}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Video Playback E2E ${slug}`, slug, uid('org')],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Video Playback Facility ${slug}`],
    );

    // Course creator — an org user, never logged in; only needed to satisfy
    // courses.created_by_org_user_id.
    const creatorEmail = uid('creator');
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Video', 'Creator', 'Video Creator', NOW(), NOW())`,
      [creatorUserId, creatorEmail, await bcrypt.hash('unused-not-logged-in', 10)],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [creatorOrgUserId, creatorUserId, orgId],
    );

    const subPeriodEnd = new Date();
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, paused_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", NOW(), $5, false, NULL, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
        subPeriodEnd,
      ],
    );

    await client.query(
      `INSERT INTO courses (id, title, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'video'::"CourseType", false, NOW(), NOW())`,
      [courseId, `Video Playback E2E Course ${slug}`, creatorOrgUserId],
    );

    // Two video lessons — B exists solely so the "only the active player
    // requests bytes" mobile assertion has a second, inactive player to check.
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", video_provider, video_storage_uri, video_duration_seconds, media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', '', 0, 'self', $3, $4, 'ready'::"MediaStatus", NOW(), NOW())`,
      [lessonAId, courseId, videoStorageUri, FIXTURE_DURATION_SECONDS],
    );
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", video_provider, video_storage_uri, video_duration_seconds, media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 2', '', 1, 'self', $3, $4, 'ready'::"MediaStatus", NOW(), NOW())`,
      [lessonBId, courseId, videoStorageUri, FIXTURE_DURATION_SECONDS],
    );

    // Course-level quiz (video courses attach the quiz to the course, not a
    // lesson — see src/lib/learn/get-learn-payload.ts).
    await client.query(
      `INSERT INTO quizzes (id, course_id, title, passing_score, allowed_attempts, time_limit, created_at)
       VALUES ($1, $2, 'Video Playback E2E Quiz', 70, 3, NULL, NOW())`,
      [quizId, courseId],
    );
    await client.query(
      `INSERT INTO questions (id, quiz_id, text, type, options, correct_answer, "order")
       VALUES ($1, $2, 'Which option is correct?', 'multiple_choice', $3::jsonb, 'A', 0)`,
      [questionId, quizId, JSON.stringify(['A', 'B', 'C', 'D'])],
    );

    return {
      orgId,
      facilityId,
      creatorUserId,
      courseId,
      lessonAId,
      lessonBId,
      quizId,
      minioObjectKey,
    };
  } finally {
    await client.end();
  }
}

async function cleanupCourseFixture(fixture: CourseFixture): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM questions WHERE quiz_id = $1`, [fixture.quizId]);
    await client.query(`DELETE FROM quizzes WHERE id = $1`, [fixture.quizId]);
    await client.query(`DELETE FROM lessons WHERE course_id = $1`, [fixture.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [fixture.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [fixture.orgId]);
    // Delete the user's org membership before the user row itself — but capture
    // creatorUserId up front (returned from seedCourseFixture) rather than
    // re-deriving it via a subquery here, since that subquery would already see
    // an empty organization_users table if run after the line above.
    await client.query(`DELETE FROM organization_users WHERE organization_id = $1`, [
      fixture.orgId,
    ]);
    await client.query(`DELETE FROM users WHERE id = $1`, [fixture.creatorUserId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [fixture.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [fixture.orgId]);
  } finally {
    await client.end();
  }

  try {
    const minioClient = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    await minioClient.removeObject(MINIO_BUCKET, fixture.minioObjectKey);
  } catch {
    // Best-effort — a leaked test object under e2e/video-playback/ is
    // harmless and won't collide with a future run (random slug per run).
  }
}

interface Learner {
  workerId: string;
  workerOrgUserId: string;
  enrollmentId: string;
  email: string;
  password: string;
}

/** Fresh worker + enrollment (progress 0, videoPositionSeconds 0) for ONE test. */
async function seedLearner(fixture: CourseFixture): Promise<Learner> {
  const client = await db();
  try {
    const email = uid('worker');
    const password = 'VideoE2E!Watch9';
    const hashed = await bcrypt.hash(password, 10);
    const workerId = crypto.randomUUID();
    const workerOrgUserId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Video', 'Learner', 'Video Learner', NOW(), NOW())`,
      [workerId, email, hashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'front_desk_admin'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [workerOrgUserId, workerId, fixture.orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), workerOrgUserId, fixture.facilityId],
    );
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, video_position_seconds, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress'::"EnrollmentStatus", 0, 0, NOW())`,
      [enrollmentId, workerOrgUserId, fixture.courseId, fixture.facilityId],
    );

    return { workerId, workerOrgUserId, enrollmentId, email, password };
  } finally {
    await client.end();
  }
}

async function cleanupLearner(learner: Learner): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM quiz_attempts WHERE enrollment_id = $1`, [
      learner.enrollmentId,
    ]);
    await client.query(`DELETE FROM enrollments WHERE id = $1`, [learner.enrollmentId]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      learner.workerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [learner.workerOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [learner.workerId]);
  } finally {
    await client.end();
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

let courseFixture: CourseFixture | null = null;
let skipReason: string | null = null;

test.beforeAll(async () => {
  if (!fs.existsSync(FIXTURE_PATH)) {
    skipReason =
      `Missing ${FIXTURE_PATH} — generate it once with ` +
      `tests/e2e/fixtures/generate-video-fixture.sh (needs ffmpeg), then commit it.`;
    return;
  }
  if (!(await isMinioReachable())) {
    skipReason =
      `Local MinIO not reachable at ${MINIO_ENDPOINT}:${MINIO_PORT} — the video proxy ` +
      `(src/app/api/video/[lessonId]/route.ts) has no bytes to stream without it. ` +
      `CI starts a real MinIO container; start one locally to run this spec.`;
    return;
  }
  courseFixture = await seedCourseFixture();
});

test.afterAll(async () => {
  if (courseFixture) await cleanupCourseFixture(courseFixture);
});

test.describe('Video course playback', () => {
  test.beforeEach(() => {
    test.skip(!!skipReason, skipReason ?? '');
  });

  test('the SSR-rendered learn page carries the video src and poster in the initial HTML, before hydration', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);

      // page.goto() resolves to the top-level navigation Response — reading
      // its body is the raw document Next served, before any client JS ran.
      // This is what actually proves PR 6's SSR win: a hydrated-DOM query
      // would pass even if the src were injected client-side after mount.
      const response = await page.goto(`/learn/${fixture.courseId}`);
      expect(response?.ok()).toBe(true);
      const html = await response!.text();

      expect(html).toContain(`/api/video/${fixture.lessonAId}`);
      expect(html).toContain(`/api/video/${fixture.lessonAId}/poster`);
    } finally {
      await cleanupLearner(learner);
    }
  });

  test('the video request returns 206 Partial Content with Content-Range and Accept-Ranges', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);

      const videoResponsePromise = page.waitForResponse(
        (res) => res.url().includes(`/api/video/${fixture.lessonAId}`) && res.status() === 206,
      );
      await page.goto(`/learn/${fixture.courseId}`);
      const videoResponse = await videoResponsePromise;

      expect(videoResponse.headers()['content-range']).toBeTruthy();
      expect(videoResponse.headers()['accept-ranges']).toBe('bytes');
    } finally {
      await cleanupLearner(learner);
    }
  });

  test('seeking issues a further Range request and playback resumes from the new position', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);
      await page.goto(`/learn/${fixture.courseId}`);

      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);

      // Play briefly first so the seek target (mid-clip) is within the
      // watch-through high-water mark — otherwise the seek-clamp (a SEPARATE,
      // deliberate behavior under test elsewhere in this file) would snap it
      // straight back, and this test would be exercising the clamp instead of
      // genuine range-request-on-seek behavior.
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement;
        v.playbackRate = 4;
        void v.play();
      });
      await page.waitForFunction(
        () => (document.querySelector('video') as HTMLVideoElement).currentTime > 2,
      );
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement;
        v.pause();
      });

      const seekRequestPromise = page.waitForResponse(
        (res) => res.url().includes(`/api/video/${fixture.lessonAId}`) && res.status() === 206,
      );
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement;
        v.currentTime = Math.max(0, v.currentTime - 1.5);
      });
      const seekResponse = await seekRequestPromise;
      expect(seekResponse.headers()['content-range']).toBeTruthy();

      await page.evaluate(() => void (document.querySelector('video') as HTMLVideoElement).play());
      const timeAfterSeek = await page.evaluate(
        () => (document.querySelector('video') as HTMLVideoElement).currentTime,
      );
      await expect
        .poll(
          () =>
            page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime),
          { timeout: 10000 },
        )
        .toBeGreaterThan(timeAfterSeek);
    } finally {
      await cleanupLearner(learner);
    }
  });

  test('playing through to the watch-gate threshold unlocks "Proceed to Quiz"', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);
      await page.goto(`/learn/${fixture.courseId}`);

      const proceedButton = page.getByRole('button', { name: 'Proceed to Quiz' });
      await expect(proceedButton).toBeVisible();
      await expect(proceedButton).toBeDisabled();
      await expect(page.getByText('Watch the video to unlock the quiz')).toBeVisible();

      // Genuine playback, sped up — advanceWatchedMark's wall-clock invariant
      // (src/lib/video/gating.ts) explicitly accounts for playbackRate, so
      // this is real watch-through credit, not a shortcut around the gate.
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement;
        v.playbackRate = 8;
        void v.play();
      });

      // ~6s of clip at 8x is under a second; a generous ceiling absorbs CI slack.
      await expect(proceedButton).toBeEnabled({ timeout: 20000 });
    } finally {
      await cleanupLearner(learner);
    }
  });

  test('a forward scrub past the watch-through mark is clamped back and does not unlock the quiz', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);
      await page.goto(`/learn/${fixture.courseId}`);

      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);

      // Freshly loaded: the watch-through mark is 0 (seeded videoPositionSeconds
      // = 0). Scrub straight to near the end without ever playing.
      await page.evaluate((duration: number) => {
        const v = document.querySelector('video') as HTMLVideoElement;
        v.currentTime = duration - 0.2;
      }, FIXTURE_DURATION_SECONDS);

      // clampSeekTarget snaps this back to the mark (0) + tolerance (1.5s).
      await expect
        .poll(() =>
          page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime),
        )
        .toBeLessThan(2);

      const proceedButton = page.getByRole('button', { name: 'Proceed to Quiz' });
      await expect(proceedButton).toBeDisabled();
    } finally {
      await cleanupLearner(learner);
    }
  });

  test.skip('the mobile backgrounding regression (a >1.5s gap between timeupdate events from a backgrounded tab) cannot be faithfully reproduced in Playwright', async () => {
    // NOT a vacuous placeholder — documenting a real coverage gap.
    //
    // The bug PR 7 fixed: on mobile, backgrounding the tab suspends
    // `timeupdate` dispatch while the media clock keeps advancing, so the
    // NEXT `timeupdate` reports a large jump in `video.currentTime` with no
    // intervening `seeking`/`seeked` pair (it wasn't a seek — playback simply
    // continued while the browser throttled event delivery). The fix
    // (src/lib/video/gating.ts's `advanceWatchedMark`) judges each step
    // against wall-clock-elapsed-time-times-playbackRate rather than a fixed
    // media-time threshold, so a large jump backed by an equally large wall
    // gap still reads as genuine.
    //
    // Reproducing the TRIGGER end-to-end needs the browser to keep
    // decoding/advancing the media clock while independently throttling
    // `timeupdate` dispatch — a real UA background-tab optimization that
    // Playwright/CDP expose no lever for:
    //   - Programmatically setting `video.currentTime` always fires
    //     `seeking`/`seeked` first, which routes through `handleSeeked` /
    //     `clampSeekTarget` instead — the SEEK path, not the backgrounding
    //     path this bug is about (that path IS covered above, faithfully).
    //   - CDP's `Page.setWebLifecycleState({state: 'frozen'})` freezes JS
    //     execution entirely, which also stops the media clock — the
    //     opposite of the bug (media keeps running, only event dispatch
    //     lags), so it doesn't reproduce the mismatch either.
    //   - `page.clock` (Playwright's virtual-time control) fakes
    //     `Date.now()`/timers, not the browser's independent audio/video
    //     presentation clock, so it can force a wall-clock jump but not a
    //     correspondingly real media-time jump without an actual seek.
    //
    // The exact invariant this bug lives in — mediaDelta vs.
    // wallDelta*playbackRate, including a synthetic 60s-backgrounded jump —
    // is unit-tested directly and exhaustively in src/lib/video/gating.test.ts
    // ("THE REGRESSION LOCK: credits a 60s jump when 60s of wall clock also
    // passed" / "drives the gate to unlock across a backgrounded
    // watch-through"). That is the correct and sufficient layer for this
    // regression; an e2e attempt here would either be redundant with those
    // unit tests (if it drove the pure function directly) or silently test
    // nothing (if it tried to fake browser backgrounding and the fake
    // didn't actually reproduce the throttling).
  });
});

// ── Mobile viewport ──────────────────────────────────────────────────────────

test.describe('Video course playback — mobile viewport', () => {
  // The project's playwright.config.ts only configures a `chromium` project
  // (no separate mobile/webkit project), so this deliberately does NOT spread
  // `devices['iPhone 13']` — that preset's `defaultBrowserType: 'webkit'`
  // cannot be overridden inside a describe-scoped `test.use()` (Playwright
  // forces browser-type selection to be a top-level/project-config setting).
  // Instead it reproduces the same viewport/touch profile on chromium, which
  // is what every other mobile-flavored assertion in this suite needs: a
  // narrow viewport with touch input, not WebKit's specific engine quirks.
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test.beforeEach(() => {
    test.skip(!!skipReason, skipReason ?? '');
  });

  test('no horizontal overflow, the Previous/Next nav is visible, and the player sits in an aspect-video box', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      await loginAs(page, learner.email, learner.password);
      await page.goto(`/learn/${fixture.courseId}`);

      const video = page.locator('video').first();
      await expect(video).toBeVisible();

      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      // CourseArticle's bottom nav — only rendered in the full learn layout.
      const nextButton = page.getByRole('button', { name: 'Next' });
      await expect(nextButton).toBeVisible();
      await expect(nextButton).toBeInViewport();

      const box = await video.boundingBox();
      expect(box).not.toBeNull();
      // aspect-video ⇒ 16:9, ±5% for rounding/controls chrome.
      const ratio = box!.width / box!.height;
      expect(ratio).toBeGreaterThan(16 / 9 - 0.3);
      expect(ratio).toBeLessThan(16 / 9 + 0.3);
    } finally {
      await cleanupLearner(learner);
    }
  });

  test('only the active lesson\'s player requests video bytes — the inactive one stays preload="none"', async ({
    page,
  }) => {
    const fixture = courseFixture!;
    const learner = await seedLearner(fixture);
    try {
      const requestedLessonIds = new Set<string>();
      page.on('request', (req) => {
        const match = req.url().match(/\/api\/video\/([^/?]+)/);
        if (match) requestedLessonIds.add(match[1]);
      });

      await loginAs(page, learner.email, learner.password);
      await page.goto(`/learn/${fixture.courseId}`);

      // Settle point: the active player's metadata has loaded. Any bytes the
      // inactive player was ever going to request (it never should, at
      // preload="none") would have been requested by now.
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);

      expect(requestedLessonIds.has(fixture.lessonAId)).toBe(true);
      expect(requestedLessonIds.has(fixture.lessonBId)).toBe(false);
    } finally {
      await cleanupLearner(learner);
    }
  });
});

// ── Catalog grid (PR 5) — NOT COVERED, see note ─────────────────────────────

test.describe('Video course catalog grid', () => {
  test.skip('renders <img> posters instead of <video> elements and does not fire N preview-video requests', async () => {
    // Genuine gap, not an oversight: VideoCourseCard
    // (src/components/dashboard/courses/VideoCourseCard.tsx) and the server
    // action it renders (listAvailableVideoCourses in
    // src/app/actions/offering.ts) both exist and were touched by this PR
    // series (PR 5 — "kill the catalog thumbnail hack" — is in
    // VideoCourseCard.test.tsx's own header comment), but as of this branch
    // NO page under src/app imports VideoCourseCard or calls
    // listAvailableVideoCourses — grep confirms the only importers are the
    // component's own file and its unit test. There is no live route to
    // navigate Playwright to for this assertion.
    //
    // The <img>-not-<video> behavior itself IS covered, at the component
    // level, by the pre-existing VideoCourseCard.test.tsx. This e2e gap is
    // "no page renders this component yet," not "the component is
    // untested" — worth confirming with the team whether a catalog route is
    // still planned before writing e2e coverage that would have nothing to
    // exercise.
  });
});
