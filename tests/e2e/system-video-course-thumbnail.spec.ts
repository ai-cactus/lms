/**
 * E2E spec: BUG-17 video-course thumbnails, driven from the system back office.
 *
 * Covers, against the LIVE app:
 *  - ThumbnailPanel (src/app/system/video-courses/[courseId]/edit/ThumbnailPanel.tsx)
 *    shows the correct source label and renders the resolved image
 *    (src/lib/video/thumbnail.ts's custom → preview → lesson → none chain).
 *  - Uploading a real image through the panel sets a custom thumbnail; removing
 *    it reverts to the automatic chain.
 *  - A spoofed-MIME / non-image upload is safely rejected without touching the
 *    row.
 *  - "Regenerate from video" fails safely (a visible error, not a crash) in
 *    this environment, which has no ffmpeg binary.
 *
 * ── System-admin precondition (this spec's OWN gate, not shared with the rest
 *    of tests/e2e) ──
 *
 * Every route under /system/** is gated by SYSTEM_ADMIN_PASSWORD
 * (src/app/actions/system-admin.ts, src/lib/system-auth.ts): when that env var
 * is unset on the running server, `isSystemAdminEnabled()` is false and the
 * layout 404s the entire namespace — there is no cookie you can hand-craft
 * around that, unlike a normal auth check. `.env.e2e` (committed, used by both
 * CI and `npm run e2e:local`) does NOT set it, which is exactly why
 * reminders.spec.ts's REM-003/REM-004 already self-skip on
 * PLAYWRIGHT_SYSTEM_ADMIN_COOKIE. This spec has the same dependency one layer
 * earlier: it drives the real /system login form rather than injecting a
 * cookie, so it needs SYSTEM_ADMIN_PASSWORD itself (not
 * PLAYWRIGHT_SYSTEM_ADMIN_COOKIE) present in the server's environment when the
 * webServer process starts, e.g.:
 *
 *   SYSTEM_ADMIN_PASSWORD=e2e-system-admin npm run e2e:local -- system-video-course-thumbnail.spec.ts
 *
 * Without it, this whole file self-skips with a clear reason — never a silent
 * pass. Do not add SYSTEM_ADMIN_PASSWORD to the committed .env.e2e as a side
 * effect of running this locally: that would newly enable REM-003/REM-004 and
 * every other /system/** flow in CI, which is a scope decision for the team,
 * not this spec.
 *
 * DB + MinIO seeding follows video-playback.spec.ts's pattern (raw `pg`, a
 * real object in MinIO — the thumbnail route streams from actual storage).
 * The course is authored by the platform's real "System" identity
 * (src/lib/video/system-user.ts's org/user), upserted idempotently and never
 * deleted; only the course/lesson rows and MinIO objects this spec creates are
 * cleaned up.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as crypto from 'crypto';
import * as net from 'net';
import * as Minio from 'minio';
import sharp from 'sharp';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = Number(process.env.MINIO_PORT) || 9010;
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'lms_minio_e2e';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'lms_minio_secret_e2e';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'lms-documents';

const SYSTEM_ORG_SLUG = 'system';
const SYSTEM_USER_EMAIL = 'system@theraptly.internal';

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
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

async function jpeg(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

interface CourseFixture {
  courseId: string;
  lessonId: string;
  lessonPosterKey: string;
}

async function seedCourseFixture(): Promise<CourseFixture> {
  const client = await db();
  try {
    // The platform's real "System" identity (src/lib/video/system-user.ts),
    // upserted the same way getOrCreateSystemUser() does. Idempotent and
    // shared: never deleted by this spec's cleanup.
    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES (gen_random_uuid(), 'System', $1, $2, false, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [SYSTEM_ORG_SLUG, SYSTEM_USER_EMAIL],
    );
    const { rows: orgRows } = await client.query(`SELECT id FROM organizations WHERE slug = $1`, [
      SYSTEM_ORG_SLUG,
    ]);
    const systemOrgId: string = orgRows[0].id;

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, true, 'credentials', 'System', 'System', 'System', NOW(), NOW())
       ON CONFLICT (email) DO NOTHING`,
      [SYSTEM_USER_EMAIL, crypto.randomBytes(32).toString('hex')],
    );
    const { rows: userRows } = await client.query(`SELECT id FROM users WHERE email = $1`, [
      SYSTEM_USER_EMAIL,
    ]);
    const systemUserId: string = userRows[0].id;

    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'admin'::"UserRole", true, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (user_id, organization_id) DO NOTHING`,
      [systemUserId, systemOrgId],
    );
    const { rows: ouRows } = await client.query(
      `SELECT id FROM organization_users WHERE user_id = $1 AND organization_id = $2`,
      [systemUserId, systemOrgId],
    );
    const systemOrgUserId: string = ouRows[0].id;

    const slug = uid('thumb');
    const courseId = crypto.randomUUID();
    const lessonId = crypto.randomUUID();

    // A real object in MinIO for the lesson poster: the thumbnail route
    // streams from actual storage, and the "lesson" tier must have something
    // real to fall back to before any custom thumbnail is uploaded.
    const lessonPosterKey = `system/videos/posters/e2e-${slug}-lesson.jpg`;
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
    const lessonPosterBuffer = await jpeg(320, 180, { r: 44, g: 143, b: 136 });
    await minioClient.putObject(
      MINIO_BUCKET,
      lessonPosterKey,
      lessonPosterBuffer,
      lessonPosterBuffer.length,
      {
        'Content-Type': 'image/jpeg',
      },
    );
    const lessonPosterUri = `minio://${MINIO_BUCKET}/${lessonPosterKey}`;

    await client.query(
      `INSERT INTO courses (id, title, status, created_by_org_user_id, organization_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'video'::"CourseType", true, NOW(), NOW())`,
      [courseId, `VISUAL CHECK — Video Course Thumbnail E2E ${slug}`, systemOrgUserId, systemOrgId],
    );
    // videoStorageUri deliberately does NOT need to be a real, playable
    // object: "Regenerate from video" fails during ffmpeg extraction either
    // way in this environment (no ffmpeg binary), well before the URI is
    // dereferenced for real bytes.
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", video_provider, video_storage_uri, video_duration_seconds, video_poster_storage_uri, media_status, created_at, updated_at)
       VALUES ($1, $2, 'Module 1', '', 0, 'self', $3, 120, $4, 'ready'::"MediaStatus", NOW(), NOW())`,
      [
        lessonId,
        courseId,
        `minio://${MINIO_BUCKET}/system/videos/e2e-${slug}-video.mp4`,
        lessonPosterUri,
      ],
    );

    return { courseId, lessonId, lessonPosterKey };
  } finally {
    await client.end();
  }
}

async function cleanupCourseFixture(fixture: CourseFixture): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM lessons WHERE course_id = $1`, [fixture.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [fixture.courseId]);
  } finally {
    await client.end();
  }

  if (await isMinioReachable()) {
    const minioClient = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    const toRemove = [fixture.lessonPosterKey];
    // Any custom thumbnail the test uploaded — best-effort, under the
    // course's own prefix only (mirrors isCustomThumbnailStorageUri's scope).
    const stream = minioClient.listObjectsV2(
      MINIO_BUCKET,
      `system/videos/thumbnails/${fixture.courseId}/`,
      true,
    );
    for await (const obj of stream) {
      if (obj.name) toRemove.push(obj.name);
    }
    await Promise.all(
      toRemove.map((key) => minioClient.removeObject(MINIO_BUCKET, key).catch(() => undefined)),
    );
  }
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto('/system');
  await page.getByPlaceholder('Enter system admin password').fill(SYSTEM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  // The authenticated and unauthenticated views are both served at '/system'
  // (a client-side router.refresh(), not a URL change), so waitForURL would
  // resolve instantly against the pre-login URL without ever confirming the
  // cookie was set. Wait for the authenticated layout's nav instead.
  await expect(page.getByRole('link', { name: 'Video Courses' })).toBeVisible({ timeout: 15000 });
}

test.describe('System video-course thumbnails (BUG-17)', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD,
    "Skipped: SYSTEM_ADMIN_PASSWORD not set on the server — see this file's header comment. " +
      'The entire /system/** namespace 404s without it; there is no cookie workaround.',
  );

  let minioReady = false;
  let fixture: CourseFixture | undefined;

  test.beforeAll(async () => {
    minioReady = await isMinioReachable();
    if (!minioReady) return;
    fixture = await seedCourseFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanupCourseFixture(fixture);
  });

  test('system admin can view, upload, remove and safely fail to regenerate a course thumbnail', async ({
    page,
  }) => {
    test.skip(
      !minioReady,
      'Skipped: MinIO is not reachable at ' + `${MINIO_ENDPOINT}:${MINIO_PORT}`,
    );
    const { courseId } = fixture!;

    await loginAsSystemAdmin(page);
    await page.goto(`/system/video-courses/${courseId}/edit`);

    const panel = page.locator('section', {
      has: page.getByRole('heading', { name: 'Thumbnail' }),
    });
    await expect(panel).toBeVisible();
    const sourceLabel = panel.getByTestId('thumbnail-source');
    const image = panel.getByRole('img', { name: 'Current course thumbnail' });

    // Initial state: no custom thumbnail yet, falls back to the lesson poster.
    await expect(sourceLabel).toHaveText('Generated from lesson video');
    await expect(image).toBeVisible();
    const initialSrc = await image.getAttribute('src');
    expect(initialSrc).toContain(`/api/system/video-courses/${courseId}/thumbnail`);
    // toBeVisible() alone does not prove the <img> actually decoded — a broken
    // image (e.g. its request 401ing) still occupies layout and passes it. This
    // page holds the system-admin cookie and NO portal session, so assert the
    // pixels actually loaded, not just that a same-sized box is present.
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        message: 'Thumbnail <img> never finished loading (naturalWidth stayed 0)',
      })
      .toBeGreaterThan(0);

    // Reject a spoofed-MIME upload before touching anything real.
    const fileInput = panel.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'not-an-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is definitely not image bytes'),
    });
    await expect(panel.getByText('The file is not a readable image')).toBeVisible();
    await expect(sourceLabel).toHaveText('Generated from lesson video');

    // Upload a real, small JPEG — becomes the custom thumbnail.
    const uploadBuffer = await jpeg(400, 225, { r: 200, g: 40, b: 40 });
    await fileInput.setInputFiles({
      name: 'custom-thumb.jpg',
      mimeType: 'image/jpeg',
      buffer: uploadBuffer,
    });
    await expect(sourceLabel).toHaveText('Custom upload');
    await expect(image).toBeVisible();
    await expect.poll(() => image.getAttribute('src')).not.toBe(initialSrc);
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        message: 'Custom-upload <img> never finished loading (naturalWidth stayed 0)',
      })
      .toBeGreaterThan(0);

    // "Regenerate from video" is not blocked (the lesson is ready and has a
    // video), but this environment has no ffmpeg binary, so it must fail
    // safely — an alert, never an unhandled crash — leaving the custom
    // thumbnail in place.
    const regenerateButton = panel.getByRole('button', { name: 'Regenerate from video' });
    await expect(regenerateButton).toBeEnabled();
    await regenerateButton.click();
    await expect(panel.getByText('Thumbnail not updated')).toBeVisible();
    await expect(sourceLabel).toHaveText('Custom upload');

    // Remove the custom thumbnail — reverts to the automatic chain.
    await panel.getByRole('button', { name: 'Remove custom' }).click();
    await expect(sourceLabel).toHaveText('Generated from lesson video');
    await expect(panel.getByRole('button', { name: 'Remove custom' })).toBeDisabled();
  });
});
