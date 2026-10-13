/**
 * E2E spec: PERMANENT user deletion from the /system console.
 *
 * The permanent delete is the second step after the soft delete: it destroys the
 * identity and everything tied to it (memberships, enrollments, certificates,
 * invites and emails to the address, ...) and frees the email to register again.
 * Mocked unit tests cannot see a cascade or a foreign-key refusal; only a real
 * Postgres can, so this drives the live app.
 *
 * Covers, against the LIVE app:
 *  - A live user's detail page offers the soft delete and NO permanent control.
 *  - After the soft delete, the page offers "Permanently delete"; the modal gates
 *    its button on the EXACT email and the acknowledgement checkbox, and lists
 *    what will be destroyed.
 *  - After the permanent delete the users, organization_users, enrollments,
 *    certificates, invites-for-the-email, emails sent to the address and
 *    verification tokens are gone, the audit row exists (ids and counts only),
 *    and other people's rows in the same organization are untouched.
 *  - The same email can then sign up again.
 *  - A person who authored a course or uploaded a document is REFUSED with the
 *    exact message, and nothing is deleted.
 *
 * ── Preconditions ──
 * Every route under /system/** 404s unless SYSTEM_ADMIN_PASSWORD is set on the
 * running server, and the control only exists when SYSTEM_HARD_DELETE_ENABLED is
 * 'true'. `.env.e2e` and CI set both. Without them this file self-skips with a
 * clear reason, never a silent pass.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;
const HARD_DELETE_ENABLED = process.env.SYSTEM_HARD_DELETE_ENABLED === 'true';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

const PASSWORD = 'HardDelete-E2E-Pass1!';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

interface Person {
  userId: string;
  orgUserId: string;
  email: string;
}

interface Fixture {
  slug: string;
  orgId: string;
  facilityId: string;
  owner: Person;
  learner: Person;
  author: Person;
  live: Person;
  courseId: string;
  documentId: string;
  enrollmentId: string;
  certificateId: string;
  inviteId: string;
  emailMessageId: string;
}

function person(slug: string, label: string): Person {
  return {
    userId: crypto.randomUUID(),
    orgUserId: crypto.randomUUID(),
    email: `${slug}-${label}@hard-delete-e2e.invalid`,
  };
}

async function insertPerson(
  client: Client,
  f: { orgId: string },
  p: Person,
  role: string,
  names: [string, string],
) {
  await client.query(
    `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
     VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
    [p.userId, p.email, await bcrypt.hash(PASSWORD, 10), names[0], names[1], names.join(' ')],
  );
  await client.query(
    `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
    [p.orgUserId, p.userId, f.orgId, role],
  );
}

/**
 * One organization. The learner (to be permanently deleted) holds an enrollment,
 * a certificate, a pending invite, an email sent to them and a verification
 * token. The author wrote a course and uploaded a document. The owner and a
 * second live member must survive everything.
 */
async function seedFixture(): Promise<Fixture> {
  const client = await db();
  try {
    const slug = uid('hd');
    const f: Fixture = {
      slug,
      orgId: crypto.randomUUID(),
      facilityId: crypto.randomUUID(),
      owner: person(slug, 'owner'),
      learner: person(slug, 'learner'),
      author: person(slug, 'author'),
      live: person(slug, 'live'),
      courseId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      enrollmentId: crypto.randomUUID(),
      certificateId: crypto.randomUUID(),
      inviteId: crypto.randomUUID(),
      emailMessageId: crypto.randomUUID(),
    };

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [f.orgId, `Hard Delete E2E ${slug}`, slug, f.owner.email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [f.facilityId, f.orgId, `Hard Delete Facility ${slug}`],
    );

    await insertPerson(client, f, f.owner, 'owner', ['Olive', 'Owner']);
    await insertPerson(client, f, f.learner, 'nurse', ['Lena', 'Learner']);
    await insertPerson(client, f, f.author, 'hr', ['Arlo', 'Author']);
    await insertPerson(client, f, f.live, 'nurse', ['Liam', 'Live']);

    await client.query(
      `INSERT INTO courses (id, title, status, organization_id, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, NOW(), NOW())`,
      [f.courseId, `Hard Delete E2E Course ${slug}`, f.orgId, f.author.orgUserId],
    );
    await client.query(
      `INSERT INTO documents (id, organization_id, organization_user_id, filename, original_name, mime_type, size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1024, NOW(), NOW())`,
      [f.documentId, f.orgId, f.author.orgUserId, `${slug}-policy.pdf`, 'Policy.pdf'],
    );

    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'completed'::"EnrollmentStatus", 100, 95, NOW(), NOW())`,
      [f.enrollmentId, f.learner.orgUserId, f.courseId, f.facilityId],
    );
    await client.query(
      `INSERT INTO certificates (id, enrollment_id, organization_user_id, course_id, issued_at, score)
       VALUES ($1, $2, $3, $4, NOW(), 95)`,
      [f.certificateId, f.enrollmentId, f.learner.orgUserId, f.courseId],
    );

    await client.query(
      `INSERT INTO invites (id, email, token, organization_id, facility_id, role, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'nurse'::"UserRole", 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [f.inviteId, f.learner.email, crypto.randomBytes(16).toString('hex'), f.orgId, f.facilityId],
    );
    await client.query(
      `INSERT INTO email_messages (id, to_email, kind, status, attempts, max_attempts, created_at, updated_at)
       VALUES ($1, $2, 'e2e-hard-delete', 'sent', 1, 3, NOW(), NOW())`,
      [f.emailMessageId, f.learner.email.toUpperCase()],
    );
    await client.query(
      `INSERT INTO verification_tokens (identifier, token, type, expires)
       VALUES ($1, $2, 'password_reset', NOW() + INTERVAL '1 day')`,
      [f.learner.email, crypto.randomBytes(16).toString('hex')],
    );

    return f;
  } finally {
    await client.end();
  }
}

async function cleanupFixture(f: Fixture): Promise<void> {
  const client = await db();
  const people = [f.owner, f.learner, f.author, f.live];
  const orgUserIds = people.map((p) => p.orgUserId);
  const userIds = people.map((p) => p.userId);
  try {
    await client.query(`DELETE FROM certificates WHERE id = $1`, [f.certificateId]);
    await client.query(`DELETE FROM enrollments WHERE id = $1`, [f.enrollmentId]);
    await client.query(`DELETE FROM documents WHERE id = $1`, [f.documentId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [f.courseId]);
    await client.query(`DELETE FROM invites WHERE id = $1`, [f.inviteId]);
    await client.query(`DELETE FROM email_messages WHERE id = $1`, [f.emailMessageId]);
    await client.query(`DELETE FROM verification_tokens WHERE identifier ILIKE $1`, [
      `${f.slug}-%`,
    ]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      orgUserIds,
    ]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [f.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [f.orgId]);
  } finally {
    await client.end();
  }
}

async function count(client: Client, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n);
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto('/system');
  await page.getByPlaceholder('Enter system admin password').fill(SYSTEM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  // The unauthenticated and authenticated views share the '/system' URL, so wait
  // for the authenticated layout's nav rather than the URL.
  await expect(page.getByRole('link', { name: 'Video Courses' })).toBeVisible({ timeout: 15000 });
}

const AUTHORED_REFUSAL =
  'This user authored 1 course(s) and uploaded 1 document(s). Delete the organization instead; content is never reassigned.';

test.describe('System permanent user deletion', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD || !HARD_DELETE_ENABLED,
    'Skipped: SYSTEM_ADMIN_PASSWORD and SYSTEM_HARD_DELETE_ENABLED=true must both be set on the ' +
      "running server — see this file's header comment (.env.e2e and CI set them).",
  );

  let fixture: Fixture;
  let signupEmail: string | undefined;

  test.beforeAll(async () => {
    fixture = await seedFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanupFixture(fixture);
    if (signupEmail) {
      const client = await db();
      try {
        await client.query(`DELETE FROM verification_tokens WHERE identifier = $1`, [signupEmail]);
        await client.query(`DELETE FROM users WHERE email = $1`, [signupEmail]);
      } finally {
        await client.end();
      }
    }
  });

  test('a live user has the soft delete and no permanent-delete control', async ({ page }) => {
    const f = fixture;
    await loginAsSystemAdmin(page);

    await page.goto(`/system/users/${f.live.userId}`);

    await expect(page.getByRole('button', { name: /Delete This User/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Permanent deletion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Permanently delete' })).toHaveCount(0);
  });

  test('soft-delete then permanently delete a learner: records gone, audit kept, email reusable', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const f = fixture;
    await loginAsSystemAdmin(page);
    await page.goto(`/system/users/${f.learner.userId}`);

    // ── Step 1: the soft delete ────────────────────────────────────────────
    await page.getByRole('button', { name: /Delete This User/ }).click();
    const softDialog = page.getByRole('dialog');
    await expect(softDialog.getByRole('heading', { name: 'Delete User' })).toBeVisible({
      timeout: 15000,
    });
    await softDialog.getByRole('textbox').fill(f.learner.email);
    await softDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(softDialog.getByText('can no longer sign in to any organization')).toBeVisible({
      timeout: 15000,
    });

    // ── Step 2: the permanent delete ───────────────────────────────────────
    await page.goto(`/system/users/${f.learner.userId}`);
    await expect(page.getByText('Permanent deletion')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Delete This User/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Permanently delete user' })).toBeVisible({
      timeout: 15000,
    });
    await expect(dialog.getByRole('row', { name: /Organization memberships/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Enrollments/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /^Certificates/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Invites to this email/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /Emails sent to this address/ })).toContainText(
      '1',
    );

    const confirm = dialog.getByRole('button', { name: 'Permanently delete' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(f.learner.email.toUpperCase());
    await dialog.getByRole('checkbox').click();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(f.learner.email);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The success message is on screen for 2s only; the redirect is the durable signal.
    await page.waitForURL(/\/system$/, { timeout: 30000 });

    // ── DB confirmation ────────────────────────────────────────────────────
    const client = await db();
    try {
      expect(
        await count(client, `SELECT COUNT(*) n FROM users WHERE id = $1`, [f.learner.userId]),
      ).toBe(0);
      expect(
        await count(client, `SELECT COUNT(*) n FROM organization_users WHERE id = $1`, [
          f.learner.orgUserId,
        ]),
      ).toBe(0);
      expect(
        await count(client, `SELECT COUNT(*) n FROM enrollments WHERE id = $1`, [f.enrollmentId]),
      ).toBe(0);
      expect(
        await count(client, `SELECT COUNT(*) n FROM certificates WHERE id = $1`, [f.certificateId]),
      ).toBe(0);
      expect(
        await count(client, `SELECT COUNT(*) n FROM invites WHERE lower(email) = lower($1)`, [
          f.learner.email,
        ]),
      ).toBe(0);
      expect(
        await count(client, `SELECT COUNT(*) n FROM email_messages WHERE id = $1`, [
          f.emailMessageId,
        ]),
      ).toBe(0);
      expect(
        await count(
          client,
          `SELECT COUNT(*) n FROM verification_tokens WHERE lower(identifier) = lower($1)`,
          [f.learner.email],
        ),
      ).toBe(0);

      // Other people and the organization's content are untouched.
      expect(
        await count(client, `SELECT COUNT(*) n FROM users WHERE id = ANY($1)`, [
          [f.owner.userId, f.author.userId, f.live.userId],
        ]),
      ).toBe(3);
      expect(
        await count(client, `SELECT COUNT(*) n FROM courses WHERE id = $1`, [f.courseId]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM documents WHERE id = $1`, [f.documentId]),
      ).toBe(1);

      // The audit row survives with ids and counts only.
      const { rows: auditRows } = await client.query(
        `SELECT action, target_type, target_id, organization_id, actor_role, metadata
           FROM audit_logs WHERE action = 'system.user.hard_delete' AND target_id = $1`,
        [f.learner.userId],
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        target_type: 'user',
        organization_id: null,
        actor_role: 'system_admin',
      });
      expect(auditRows[0].metadata).toMatchObject({
        mode: 'hard',
        memberships: 1,
        enrollments: 1,
        certificates: 1,
        invites: 1,
        emailMessages: 1,
      });
      const auditJson = JSON.stringify(auditRows[0]).toLowerCase();
      expect(auditJson).not.toContain(f.learner.email.toLowerCase());
      expect(auditJson).not.toContain('lena');
    } finally {
      await client.end();
    }

    // ── The email can register again ───────────────────────────────────────
    signupEmail = f.learner.email;
    const signupContext = await browser.newContext();
    try {
      const signup = await signupContext.newPage();
      await signup.goto('/signup');
      await signup.getByLabel('First Name').fill('Lena');
      await signup.getByLabel('Last Name').fill('Again');
      await signup.getByLabel('Email').fill(f.learner.email);
      await signup.locator('input[name="password"]').fill(PASSWORD);
      await signup.locator('input[name="confirmPassword"]').fill(PASSWORD);
      await signup.getByRole('checkbox').first().click({ force: true });
      await signup.getByRole('button', { name: /create account/i }).click();
      await expect(signup).toHaveURL(/verify-email/, { timeout: 20000 });
      await expect(signup.getByRole('heading', { name: /check your email/i })).toBeVisible();
    } finally {
      await signupContext.close();
    }
  });

  test('an author is refused with the exact message and nothing is deleted', async ({ page }) => {
    test.setTimeout(90_000);
    const f = fixture;

    // Soft-deleted directly: the soft delete itself is covered by the other tests.
    const setup = await db();
    try {
      await setup.query(`UPDATE users SET deleted_at = NOW() WHERE id = $1`, [f.author.userId]);
    } finally {
      await setup.end();
    }

    await loginAsSystemAdmin(page);
    await page.goto(`/system/users/${f.author.userId}`);
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Permanently delete user' })).toBeVisible({
      timeout: 15000,
    });
    await expect(dialog.getByText(AUTHORED_REFUSAL)).toBeVisible();
    await expect(dialog.getByRole('textbox')).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();

    const client = await db();
    try {
      expect(
        await count(client, `SELECT COUNT(*) n FROM users WHERE id = $1`, [f.author.userId]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM organization_users WHERE id = $1`, [
          f.author.orgUserId,
        ]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM courses WHERE id = $1`, [f.courseId]),
      ).toBe(1);
      expect(
        await count(
          client,
          `SELECT COUNT(*) n FROM audit_logs WHERE action = 'system.user.hard_delete' AND target_id = $1`,
          [f.author.userId],
        ),
      ).toBe(0);
    } finally {
      await client.end();
    }
  });
});
