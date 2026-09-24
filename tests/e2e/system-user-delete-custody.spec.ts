/**
 * E2E spec: BUG-09 asset-custody transfer on user deletion, driven from the
 * system back office (fix/user-delete-course-guard).
 *
 * Why this needs a REAL database, not the 32 mocked-tx unit tests that already
 * cover `deleteUserWithRelations`: `Document.organizationUser` is declared
 * `onDelete: Cascade` (prisma/document.prisma), so the ONLY thing standing
 * between a hard delete and destroying every document that person uploaded is
 * the custody transfer (`tx.course.updateMany` / `tx.document.updateMany`)
 * running inside the SAME transaction, strictly BEFORE `tx.user.delete()`
 * (src/app/actions/system-admin.ts). A unit test with a mocked `tx` cannot
 * catch a mistake in that ordering or in Postgres's actual FK/cascade
 * behavior — only a real transaction against real constraints can.
 *
 * Covers, against the LIVE app:
 *  - The delete-preview modal lists the departing member's authored course and
 *    uploaded document as RETAINED/reassigned, not destroyed.
 *  - Completing the deletion removes the user row.
 *  - The course's `createdByOrgUserId` and the document's `organizationUserId`
 *    now point at the surviving (more senior) member — proven by reading the
 *    database directly afterward, not just the UI's success toast.
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
 *   SYSTEM_ADMIN_PASSWORD=e2e-system-admin npm run e2e:local -- system-user-delete-custody.spec.ts
 *
 * Without it, this whole file self-skips with a clear reason — never a silent
 * pass.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as crypto from 'crypto';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

interface CustodyFixture {
  orgId: string;
  survivorUserId: string;
  survivorOrgUserId: string;
  survivorEmail: string;
  departingUserId: string;
  departingOrgUserId: string;
  departingEmail: string;
  courseId: string;
  courseTitle: string;
  documentId: string;
}

/**
 * One organization, two members, and ONE course + ONE document authored by
 * the departing member — the minimum shape that exercises custody transfer.
 * The survivor is `owner` (highest `CUSTODIAN_ROLE_PRECEDENCE`), the departing
 * member is `hr`, so the custodian pick is unambiguous.
 */
async function seedCustodyFixture(): Promise<CustodyFixture> {
  const client = await db();
  try {
    const slug = uid('custody');
    const orgId = crypto.randomUUID();
    const survivorUserId = crypto.randomUUID();
    const survivorOrgUserId = crypto.randomUUID();
    const survivorEmail = `${slug}-survivor@user-delete-e2e.invalid`;
    const departingUserId = crypto.randomUUID();
    const departingOrgUserId = crypto.randomUUID();
    const departingEmail = `${slug}-departing@user-delete-e2e.invalid`;
    const courseId = crypto.randomUUID();
    const courseTitle = `User Delete Custody E2E Course ${slug}`;
    const documentId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `User Delete Custody E2E ${slug}`, slug, survivorEmail],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Sylvia', 'Survivor', 'Sylvia Survivor', NOW(), NOW())`,
      [survivorUserId, survivorEmail, crypto.randomBytes(32).toString('hex')],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [survivorOrgUserId, survivorUserId, orgId],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Derek', 'Departing', 'Derek Departing', NOW(), NOW())`,
      [departingUserId, departingEmail, crypto.randomBytes(32).toString('hex')],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [departingOrgUserId, departingUserId, orgId],
    );

    await client.query(
      `INSERT INTO courses (id, title, status, organization_id, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, NOW(), NOW())`,
      [courseId, courseTitle, orgId, departingOrgUserId],
    );

    await client.query(
      `INSERT INTO documents (id, organization_id, organization_user_id, filename, original_name, mime_type, size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1024, NOW(), NOW())`,
      [documentId, orgId, departingOrgUserId, `${slug}-policy.pdf`, 'Policy.pdf'],
    );

    return {
      orgId,
      survivorUserId,
      survivorOrgUserId,
      survivorEmail,
      departingUserId,
      departingOrgUserId,
      departingEmail,
      courseId,
      courseTitle,
      documentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanupCustodyFixture(fixture: CustodyFixture): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM documents WHERE id = $1`, [fixture.documentId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [fixture.courseId]);
    // The departing membership/user is deleted by the test itself; these are
    // best-effort in case the test failed before reaching that step.
    await client.query(`DELETE FROM organization_users WHERE organization_id = $1`, [
      fixture.orgId,
    ]);
    await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
      fixture.survivorUserId,
      fixture.departingUserId,
    ]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [fixture.orgId]);
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

test.describe('System user deletion transfers asset custody (BUG-09)', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD,
    "Skipped: SYSTEM_ADMIN_PASSWORD not set on the server — see this file's header comment. " +
      'The entire /system/** namespace 404s without it; there is no cookie workaround.',
  );

  let fixture: CustodyFixture | undefined;

  test.beforeAll(async () => {
    fixture = await seedCustodyFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanupCustodyFixture(fixture);
  });

  test('deleting the departing member reassigns their course and document instead of destroying them', async ({
    page,
  }) => {
    const f = fixture!;

    await loginAsSystemAdmin(page);

    // The users list has no URL search param — narrow via the client-side
    // search box until the departing member is the only row.
    await page.getByPlaceholder('Search by email or name...').fill(f.departingEmail);
    await expect(page.getByText(f.departingEmail)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete User Permanently' })).toBeVisible({
      timeout: 15000,
    });

    // The preview must show the course and document as KEPT/reassigned, not
    // as part of what gets destroyed — and must NOT block the delete (a
    // custodian exists).
    await expect(
      dialog.getByRole('row', { name: /Courses authored \(reassigned\)/ }),
    ).toContainText('1');
    await expect(
      dialog.getByRole('row', { name: /Documents uploaded \(reassigned\)/ }),
    ).toContainText('1');
    await expect(
      dialog.getByText(/authored courses or uploaded documents that no one is left to inherit/),
    ).not.toBeVisible();

    await dialog.getByRole('textbox').fill(f.departingEmail);
    const deleteButton = dialog.getByRole('button', { name: 'Delete Permanently' });
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await expect(dialog.getByText('has been permanently deleted')).toBeVisible({
      timeout: 15000,
    });

    // ── DB confirmation: the real transaction did what the UI claims ────────
    const client = await db();
    try {
      const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1`, [
        f.departingUserId,
      ]);
      expect(userRows).toHaveLength(0);

      const { rows: membershipRows } = await client.query(
        `SELECT id FROM organization_users WHERE id = $1`,
        [f.departingOrgUserId],
      );
      expect(membershipRows).toHaveLength(0);

      const { rows: courseRows } = await client.query(
        `SELECT created_by_org_user_id FROM courses WHERE id = $1`,
        [f.courseId],
      );
      expect(courseRows).toHaveLength(1);
      expect(courseRows[0].created_by_org_user_id).toBe(f.survivorOrgUserId);

      const { rows: documentRows } = await client.query(
        `SELECT organization_user_id FROM documents WHERE id = $1`,
        [f.documentId],
      );
      expect(documentRows).toHaveLength(1);
      expect(documentRows[0].organization_user_id).toBe(f.survivorOrgUserId);
    } finally {
      await client.end();
    }
  });
});
