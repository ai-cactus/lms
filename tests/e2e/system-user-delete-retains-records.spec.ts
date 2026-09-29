/**
 * E2E spec: Q-23 (ruled 2026-09-28) — deleting a user from the system back
 * office KEEPS their compliance records and refuses their sign-in.
 *
 * Why a real database: the soft delete's whole promise is about what Postgres
 * still holds afterwards — the `users` row, the deactivated membership, and the
 * enrollment + certificate hanging off it (`Certificate.organizationUser` and
 * `Enrollment.organizationUser` are `onDelete: Cascade`, so any regression back
 * to a hard delete would silently take them with it). Mocked unit tests cannot
 * see a cascade; only a real transaction against real constraints can.
 *
 * Covers, against the LIVE app:
 *  - The delete modal says access is removed and records are retained, and
 *    lists the member's certificate and enrollment as retained.
 *  - After the delete, the `users` row still exists with `deleted_at` set and
 *    a bumped `session_version`; the membership is deactivated, not removed;
 *    the enrollment, certificate, authored course and uploaded document are
 *    untouched (authorship NOT rewritten — BUG-49).
 *  - The deleted person's correct password is refused at /login with the same
 *    generic message an unknown account gets.
 *  - The users list hides the deleted identity by default and shows it, badged,
 *    under the "Deleted users" filter.
 *
 * ── System-admin precondition (this spec's OWN gate, same as
 *    system-video-course-thumbnail.spec.ts) ──
 *
 * Every route under /system/** 404s unless SYSTEM_ADMIN_PASSWORD is set on the
 * running server — there is no cookie workaround. `.env.e2e` deliberately does
 * not set it (that would newly enable every other /system/** flow in CI, a
 * scope decision for the team). Run this spec with it exported for that run
 * only, e.g.:
 *
 *   SYSTEM_ADMIN_PASSWORD=e2e-system-admin npm run e2e:local -- system-user-delete-retains-records.spec.ts
 *
 * Without it, this whole file self-skips with a clear reason — never a silent
 * pass.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

const DEPARTING_PASSWORD = 'Departing-E2E-Pass1!';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

interface Fixture {
  orgId: string;
  facilityId: string;
  survivorUserId: string;
  survivorOrgUserId: string;
  departingUserId: string;
  departingOrgUserId: string;
  departingEmail: string;
  courseId: string;
  documentId: string;
  enrollmentId: string;
  certificateId: string;
}

/**
 * One organization, two members. The departing member (`hr`) authored a course
 * and a document, and holds a completed enrollment with a certificate in it.
 */
async function seedFixture(): Promise<Fixture> {
  const client = await db();
  try {
    const slug = uid('q23');
    const f: Fixture = {
      orgId: crypto.randomUUID(),
      facilityId: crypto.randomUUID(),
      survivorUserId: crypto.randomUUID(),
      survivorOrgUserId: crypto.randomUUID(),
      departingUserId: crypto.randomUUID(),
      departingOrgUserId: crypto.randomUUID(),
      departingEmail: `${slug}-departing@user-delete-e2e.invalid`,
      courseId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      enrollmentId: crypto.randomUUID(),
      certificateId: crypto.randomUUID(),
    };
    const survivorEmail = `${slug}-survivor@user-delete-e2e.invalid`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [f.orgId, `User Delete Q-23 E2E ${slug}`, slug, survivorEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [f.facilityId, f.orgId, `Q-23 Facility ${slug}`],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Sylvia', 'Survivor', 'Sylvia Survivor', NOW(), NOW())`,
      [f.survivorUserId, survivorEmail, crypto.randomBytes(32).toString('hex')],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [f.survivorOrgUserId, f.survivorUserId, f.orgId],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Derek', 'Departing', 'Derek Departing', NOW(), NOW())`,
      [f.departingUserId, f.departingEmail, await bcrypt.hash(DEPARTING_PASSWORD, 10)],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [f.departingOrgUserId, f.departingUserId, f.orgId],
    );

    await client.query(
      `INSERT INTO courses (id, title, status, organization_id, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, NOW(), NOW())`,
      [f.courseId, `User Delete Q-23 E2E Course ${slug}`, f.orgId, f.departingOrgUserId],
    );
    await client.query(
      `INSERT INTO documents (id, organization_id, organization_user_id, filename, original_name, mime_type, size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1024, NOW(), NOW())`,
      [f.documentId, f.orgId, f.departingOrgUserId, `${slug}-policy.pdf`, 'Policy.pdf'],
    );

    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'completed'::"EnrollmentStatus", 100, 95, NOW(), NOW())`,
      [f.enrollmentId, f.departingOrgUserId, f.courseId, f.facilityId],
    );
    await client.query(
      `INSERT INTO certificates (id, enrollment_id, organization_user_id, course_id, issued_at, score)
       VALUES ($1, $2, $3, $4, NOW(), 95)`,
      [f.certificateId, f.enrollmentId, f.departingOrgUserId, f.courseId],
    );

    return f;
  } finally {
    await client.end();
  }
}

async function cleanupFixture(f: Fixture): Promise<void> {
  const client = await db();
  const orgUserIds = [f.survivorOrgUserId, f.departingOrgUserId];
  try {
    await client.query(`DELETE FROM certificates WHERE id = $1`, [f.certificateId]);
    await client.query(`DELETE FROM enrollments WHERE id = $1`, [f.enrollmentId]);
    await client.query(`DELETE FROM documents WHERE id = $1`, [f.documentId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [f.courseId]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      orgUserIds,
    ]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
      f.survivorUserId,
      f.departingUserId,
    ]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [f.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [f.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto('/system');
  await page.getByPlaceholder('Enter system admin password').fill(SYSTEM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  // Both the authenticated and unauthenticated views are served at '/system'
  // (a client-side router.refresh(), not a URL change), so waitForURL would
  // resolve instantly against the pre-login URL without confirming the cookie
  // was actually set. Wait for the authenticated layout's nav instead.
  await expect(page.getByRole('link', { name: 'Video Courses' })).toBeVisible({ timeout: 15000 });
}

test.describe('System user deletion keeps compliance records (Q-23)', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD,
    "Skipped: SYSTEM_ADMIN_PASSWORD not set on the server — see this file's header comment. " +
      'The entire /system/** namespace 404s without it; there is no cookie workaround.',
  );

  let fixture: Fixture | undefined;

  test.beforeAll(async () => {
    fixture = await seedFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanupFixture(fixture);
  });

  test('deleting a member revokes access everywhere and retains every record', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const f = fixture!;

    await loginAsSystemAdmin(page);

    // The users list has no URL search param — narrow via the client-side
    // search box until the departing member is the only row.
    await page.getByPlaceholder('Search by email or name...').fill(f.departingEmail);
    await expect(page.getByText(f.departingEmail)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete User' })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      dialog.getByText(
        "This removes Derek Departing's access to every organization. Certificates, quiz history and completion records are retained for compliance and are not deleted.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole('row', { name: /Certificates/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Enrollments/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Courses authored/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Documents uploaded/ })).toContainText('1');

    await dialog.getByRole('textbox').fill(f.departingEmail);
    const deleteButton = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(dialog.getByText('can no longer sign in to any organization')).toBeVisible({
      timeout: 15000,
    });

    // ── DB confirmation: nothing was destroyed or reassigned ────────────────
    const client = await db();
    try {
      const { rows: userRows } = await client.query(
        `SELECT deleted_at, session_version FROM users WHERE id = $1`,
        [f.departingUserId],
      );
      expect(userRows).toHaveLength(1);
      expect(userRows[0].deleted_at).not.toBeNull();
      expect(userRows[0].session_version).toBe(1);

      const { rows: membershipRows } = await client.query(
        `SELECT active, deactivated_at FROM organization_users WHERE id = $1`,
        [f.departingOrgUserId],
      );
      expect(membershipRows).toHaveLength(1);
      expect(membershipRows[0].active).toBe(false);
      expect(membershipRows[0].deactivated_at).not.toBeNull();

      const { rows: enrollmentRows } = await client.query(
        `SELECT status, organization_user_id FROM enrollments WHERE id = $1`,
        [f.enrollmentId],
      );
      expect(enrollmentRows).toEqual([
        { status: 'completed', organization_user_id: f.departingOrgUserId },
      ]);

      const { rows: certificateRows } = await client.query(
        `SELECT organization_user_id FROM certificates WHERE id = $1`,
        [f.certificateId],
      );
      expect(certificateRows).toEqual([{ organization_user_id: f.departingOrgUserId }]);

      // Authorship is kept, not handed to the survivor (BUG-49).
      const { rows: courseRows } = await client.query(
        `SELECT created_by_org_user_id FROM courses WHERE id = $1`,
        [f.courseId],
      );
      expect(courseRows).toEqual([{ created_by_org_user_id: f.departingOrgUserId }]);

      const { rows: documentRows } = await client.query(
        `SELECT organization_user_id FROM documents WHERE id = $1`,
        [f.documentId],
      );
      expect(documentRows).toEqual([{ organization_user_id: f.departingOrgUserId }]);
    } finally {
      await client.end();
    }

    // ── The users list: hidden by default, listed and badged under Deleted ──
    await page.goto('/system');
    await page.getByPlaceholder('Search by email or name...').fill(f.departingEmail);
    await expect(page.getByText('No users found')).toBeVisible({ timeout: 15000 });
    await page.getByRole('combobox', { name: 'Account status' }).selectOption('deleted');
    await expect(page.getByText(f.departingEmail)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();

    // ── Sign-in is refused like an unknown account, with the right password ─
    const learnerContext = await browser.newContext();
    try {
      const learner = await learnerContext.newPage();
      await learner.goto('/login');
      await learner.fill('input[type="email"]', f.departingEmail);
      await learner.fill('input[type="password"]', DEPARTING_PASSWORD);
      await learner.click('button[type="submit"]');
      await expect(learner.getByText('Invalid credentials.')).toBeVisible({ timeout: 15000 });
      await expect(learner).toHaveURL(/\/login/);
    } finally {
      await learnerContext.close();
    }
  });
});
