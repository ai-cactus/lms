/**
 * E2E spec: PERMANENT organization deletion from the /system console.
 *
 * The permanent delete is the second step after the soft delete. It destroys the
 * organization and everything it owns in one ordered transaction. A mocked unit
 * test cannot prove the ORDER: Postgres checks Restrict edges the moment a
 * cascade reaches them (Course.creator, Enrollment.course, Certificate.course,
 * QuizAttempt.quiz, CourseVersion.documentVersion), so only a real database
 * shows whether the delete works against a populated tenant.
 *
 * Covers, against the LIVE app:
 *  - A live (not soft-deleted) organization shows the soft delete and NO
 *    permanent-delete control.
 *  - A soft-deleted organization with facilities, a course (lesson, quiz,
 *    question), an enrollment with a quiz attempt and a certificate, a document
 *    with a version wired into a course version, an invite, notification events,
 *    emails and a cycle-summary run is permanently deleted through the modal,
 *    which gates its button on the exact name, DELETE and the acknowledgement.
 *  - Every one of those rows is gone afterwards; User rows survive; a person who
 *    also belongs to another organization keeps that membership; the audit row
 *    exists with ids and counts only; the slug can be reused.
 *  - An organization another organization depends on (a foreign enrollment in
 *    its course) is REFUSED with the exact message and nothing is deleted.
 *
 * Stripe is deliberately absent: the fixtures have no subscription, so no
 * Stripe call is made.
 *
 * ── Preconditions ──
 * Every route under /system/** 404s unless SYSTEM_ADMIN_PASSWORD is set on the
 * running server, and the control only exists when SYSTEM_HARD_DELETE_ENABLED is
 * 'true'. `.env.e2e` and CI set both. Without them this file self-skips with a
 * clear reason, never a silent pass.
 *
 * audit_logs is append-only (trigger); this spec never deletes from it, and
 * keys its rows by the random organization id.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;
const HARD_DELETE_ENABLED = process.env.SYSTEM_HARD_DELETE_ENABLED === 'true';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5442/lms_e2e?schema=public';

const PASSWORD = 'OrgHardDelete-E2E-Pass1!';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

async function count(client: Client, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n);
}

interface Person {
  userId: string;
  orgUserId: string;
  email: string;
}

function person(slug: string, label: string): Person {
  return {
    userId: crypto.randomUUID(),
    orgUserId: crypto.randomUUID(),
    email: `${slug}-${label}@org-hard-delete-e2e.invalid`,
  };
}

async function insertUser(client: Client, p: Person, names: [string, string]) {
  await client.query(
    `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
     VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
    [p.userId, p.email, await bcrypt.hash(PASSWORD, 4), names[0], names[1], names.join(' ')],
  );
}

async function insertMembership(client: Client, orgId: string, p: Person, role: string) {
  await client.query(
    `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
    [p.orgUserId, p.userId, orgId, role],
  );
}

async function insertOrg(client: Client, id: string, name: string, slug: string, email: string) {
  await client.query(
    `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
    [id, name, slug, email],
  );
}

interface Fixture {
  slug: string;
  orgName: string;
  orgId: string;
  otherOrgId: string;
  facilityId: string;
  owner: Person;
  author: Person;
  learner: Person;
  multi: Person;
  courseId: string;
  lessonId: string;
  quizId: string;
  questionId: string;
  enrollmentId: string;
  multiEnrollmentId: string;
  attemptId: string;
  certificateId: string;
  documentId: string;
  documentVersionId: string;
  courseVersionId: string;
  inviteId: string;
  notificationEventId: string;
  emailMessageId: string;
  cycleRunId: string;
}

/**
 * Target organization: owner, an author (wrote the course and uploaded the
 * document), a learner (enrolled, attempted the quiz, certified) and a multi-org
 * person who is also a member of a second organization.
 */
async function seedFixture(): Promise<Fixture> {
  const client = await db();
  try {
    const slug = uid('ohd');
    const f: Fixture = {
      slug,
      orgName: `Org Hard Delete E2E ${slug}`,
      orgId: crypto.randomUUID(),
      otherOrgId: crypto.randomUUID(),
      facilityId: crypto.randomUUID(),
      owner: person(slug, 'owner'),
      author: person(slug, 'author'),
      learner: person(slug, 'learner'),
      multi: person(slug, 'multi'),
      courseId: crypto.randomUUID(),
      lessonId: crypto.randomUUID(),
      quizId: crypto.randomUUID(),
      questionId: crypto.randomUUID(),
      enrollmentId: crypto.randomUUID(),
      multiEnrollmentId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      certificateId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      documentVersionId: crypto.randomUUID(),
      courseVersionId: crypto.randomUUID(),
      inviteId: crypto.randomUUID(),
      notificationEventId: crypto.randomUUID(),
      emailMessageId: crypto.randomUUID(),
      cycleRunId: crypto.randomUUID(),
    };

    await insertOrg(client, f.orgId, f.orgName, slug, f.owner.email);
    await insertOrg(client, f.otherOrgId, `Other Org ${slug}`, `${slug}-other`, f.owner.email);
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [f.facilityId, f.orgId, `Org Hard Delete Facility ${slug}`],
    );

    await insertUser(client, f.owner, ['Olive', 'Owner']);
    await insertUser(client, f.author, ['Arlo', 'Author']);
    await insertUser(client, f.learner, ['Lena', 'Learner']);
    await insertUser(client, f.multi, ['Mina', 'Multi']);
    await insertMembership(client, f.orgId, f.owner, 'owner');
    await insertMembership(client, f.orgId, f.author, 'hr');
    await insertMembership(client, f.orgId, f.learner, 'nurse');
    await insertMembership(client, f.orgId, f.multi, 'nurse');
    // The multi-org person's second membership; the picker hint points at the
    // organization about to be destroyed.
    const multiOther = crypto.randomUUID();
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [multiOther, f.multi.userId, f.otherOrgId],
    );
    await client.query(`UPDATE users SET last_active_organization_id = $2 WHERE id = $1`, [
      f.multi.userId,
      f.orgId,
    ]);

    await client.query(
      `INSERT INTO courses (id, title, status, organization_id, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, NOW(), NOW())`,
      [f.courseId, `Hard Delete Course ${slug}`, f.orgId, f.author.orgUserId],
    );
    await client.query(
      `INSERT INTO lessons (id, course_id, title, content, "order", created_at, updated_at)
       VALUES ($1, $2, 'Lesson 1', 'Body', 1, NOW(), NOW())`,
      [f.lessonId, f.courseId],
    );
    await client.query(
      `INSERT INTO quizzes (id, course_id, title, passing_score, created_at) VALUES ($1, $2, 'Final quiz', 70, NOW())`,
      [f.quizId, f.courseId],
    );
    await client.query(
      `INSERT INTO questions (id, quiz_id, text, type, options, correct_answer, "order")
       VALUES ($1, $2, 'Q1?', 'multiple_choice', '["a","b"]'::jsonb, 'a', 1)`,
      [f.questionId, f.quizId],
    );

    await client.query(
      `INSERT INTO documents (id, organization_id, organization_user_id, filename, original_name, mime_type, size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Policy.pdf', 'application/pdf', 1024, NOW(), NOW())`,
      [f.documentId, f.orgId, f.author.orgUserId, `${slug}-policy.pdf`],
    );
    await client.query(
      `INSERT INTO document_versions (id, document_id, version, storage_path, hash, created_at)
       VALUES ($1, $2, 1, $3, 'e2e-hash', NOW())`,
      [f.documentVersionId, f.documentId, `e2e-org-hard-delete/${slug}/policy.pdf`],
    );
    await client.query(
      `INSERT INTO course_versions (id, course_id, document_version_id, version, published_at)
       VALUES ($1, $2, $3, 1, NOW())`,
      [f.courseVersionId, f.courseId, f.documentVersionId],
    );

    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'completed'::"EnrollmentStatus", 100, 95, NOW(), NOW())`,
      [f.enrollmentId, f.learner.orgUserId, f.courseId, f.facilityId],
    );
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, status, progress, started_at)
       VALUES ($1, $2, $3, 'in_progress'::"EnrollmentStatus", 10, NOW())`,
      [f.multiEnrollmentId, f.multi.orgUserId, f.courseId],
    );
    await client.query(
      `INSERT INTO quiz_attempts (id, enrollment_id, quiz_id, answers, score, attempt_count, completed_at)
       VALUES ($1, $2, $3, '{}'::jsonb, 95, 1, NOW())`,
      [f.attemptId, f.enrollmentId, f.quizId],
    );
    await client.query(
      `INSERT INTO certificates (id, enrollment_id, organization_user_id, course_id, issued_at, score)
       VALUES ($1, $2, $3, $4, NOW(), 95)`,
      [f.certificateId, f.enrollmentId, f.learner.orgUserId, f.courseId],
    );

    await client.query(
      `INSERT INTO invites (id, email, token, organization_id, facility_id, role, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'nurse'::"UserRole", 'pending', NOW() + INTERVAL '7 days', NOW())`,
      [
        f.inviteId,
        `${slug}-invitee@org-hard-delete-e2e.invalid`,
        crypto.randomBytes(16).toString('hex'),
        f.orgId,
        f.facilityId,
      ],
    );
    await client.query(
      `INSERT INTO notification_events (id, organization_id, tier, type, payload, status, created_at)
       VALUES ($1, $2, 'instant'::"NotificationTier", 'e2e-hard-delete', '{}'::jsonb, 'pending', NOW())`,
      [f.notificationEventId, f.orgId],
    );
    await client.query(
      `INSERT INTO email_messages (id, to_email, kind, organization_id, status, attempts, max_attempts, created_at, updated_at)
       VALUES ($1, $2, 'e2e-hard-delete', $3, 'sent', 1, 3, NOW(), NOW())`,
      [f.emailMessageId, f.learner.email, f.orgId],
    );
    await client.query(
      `INSERT INTO cycle_summary_runs (id, organization_id, period_key, status, event_count, created_at)
       VALUES ($1, $2, $3, 'sent', 1, NOW())`,
      [f.cycleRunId, f.orgId, `e2e-${slug}`],
    );

    return f;
  } finally {
    await client.end();
  }
}

/** Safe to run whether or not the permanent delete ran. */
async function cleanupFixture(f: Fixture): Promise<void> {
  const client = await db();
  const people = [f.owner, f.author, f.learner, f.multi];
  try {
    await client.query(
      `DELETE FROM enrollments WHERE organization_user_id IN
         (SELECT id FROM organization_users WHERE organization_id = ANY($1))`,
      [[f.orgId, f.otherOrgId]],
    );
    await client.query(`DELETE FROM organizations WHERE slug = $1`, [f.slug]);
    for (const orgId of [f.orgId, f.otherOrgId]) {
      await client.query(`DELETE FROM courses WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM documents WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM invites WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM notification_events WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM email_messages WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM cycle_summary_runs WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organization_users WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await client.query(`DELETE FROM users WHERE id = ANY($1) OR email LIKE $2`, [
      people.map((p) => p.userId),
      `${f.slug}-%@org-hard-delete-e2e.invalid`,
    ]);
  } finally {
    await client.end();
  }
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto('/system');
  await page.getByPlaceholder('Enter system admin password').fill(SYSTEM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible({ timeout: 15000 });
}

async function softDeleteInDb(orgId: string): Promise<void> {
  const client = await db();
  try {
    await client.query(`UPDATE organizations SET deleted_at = NOW() WHERE id = $1`, [orgId]);
    await client.query(
      `UPDATE organization_users SET active = false, deactivated_at = NOW() WHERE organization_id = $1`,
      [orgId],
    );
  } finally {
    await client.end();
  }
}

test.describe('System permanent organization deletion', () => {
  test.skip(
    !SYSTEM_ADMIN_PASSWORD || !HARD_DELETE_ENABLED,
    'Skipped: SYSTEM_ADMIN_PASSWORD and SYSTEM_HARD_DELETE_ENABLED=true must both be set on the ' +
      "running server — see this file's header comment (.env.e2e and CI set them).",
  );

  const fixtures: Fixture[] = [];

  test.afterAll(async () => {
    for (const f of fixtures) await cleanupFixture(f);
  });

  test('a live organization has the soft delete and no permanent-delete control', async ({
    page,
  }) => {
    const f = await seedFixture();
    fixtures.push(f);
    await loginAsSystemAdmin(page);

    await page.goto(`/system/organizations/${f.orgId}`);

    await expect(page.getByRole('button', { name: /Delete This Organization/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Permanent deletion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Permanently delete' })).toHaveCount(0);
  });

  test('soft-delete then permanently delete a populated organization: rows gone, users and other memberships kept, audit kept', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const f = await seedFixture();
    fixtures.push(f);
    await loginAsSystemAdmin(page);
    await page.goto(`/system/organizations/${f.orgId}`);

    // ── Step 1: the soft delete, through the UI ────────────────────────────
    await page.getByRole('button', { name: /Delete This Organization/ }).click();
    const softDialog = page.getByRole('dialog');
    await expect(softDialog.getByRole('heading', { name: 'Delete organization' })).toBeVisible({
      timeout: 15000,
    });
    await softDialog.getByLabel('Type the organization name to confirm:').fill(f.orgName);
    await softDialog.getByLabel('Type DELETE to confirm:').fill('DELETE');
    await softDialog.getByRole('button', { name: 'Delete organization' }).click();
    await expect(softDialog.getByText('deleted. Members can no longer sign in.')).toBeVisible({
      timeout: 15000,
    });

    // ── Step 2: the permanent delete ───────────────────────────────────────
    await page.goto(`/system/organizations/${f.orgId}`);
    await expect(page.getByText('Permanent deletion')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Permanently delete organization' }),
    ).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('row', { name: /^Memberships/ })).toContainText('4');
    await expect(dialog.getByRole('row', { name: /^Courses/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /^Enrollments/ })).toContainText('2');
    await expect(dialog.getByRole('row', { name: /^Certificates/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /^Quiz attempts/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /^Documents/ })).toContainText('1');
    await expect(dialog.getByRole('row', { name: /^Invites/ })).toContainText('1');
    await expect(
      dialog.getByRole('row', { name: /Users who keep another organization/ }),
    ).toContainText('1');
    await expect(dialog.getByText('Cancel the Stripe subscription now')).toHaveCount(0);

    const confirm = dialog.getByRole('button', { name: 'Permanently delete' });
    const nameInput = dialog.getByLabel('Type the organization name to confirm:');
    const wordInput = dialog.getByLabel('Type DELETE to confirm:');
    const acknowledge = dialog.getByRole('checkbox');

    await expect(confirm).toBeDisabled();
    await nameInput.fill(f.orgName.toUpperCase());
    await wordInput.fill('DELETE');
    await acknowledge.click();
    await expect(confirm).toBeDisabled();
    await nameInput.fill(f.orgName);
    await wordInput.fill('delete');
    await expect(confirm).toBeDisabled();
    await wordInput.fill('DELETE');
    await acknowledge.click();
    await expect(confirm).toBeDisabled();
    await acknowledge.click();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The success message shows for 2s only; the redirect is the durable signal.
    await page.waitForURL(/\/system\/organizations$/, { timeout: 30000 });

    // ── DB confirmation: everything the organization owned is gone ─────────
    const client = await db();
    try {
      const gone: Array<[string, string, unknown[]]> = [
        ['organizations', 'id = $1', [f.orgId]],
        ['organization_users', 'organization_id = $1', [f.orgId]],
        ['facilities', 'organization_id = $1', [f.orgId]],
        ['courses', 'id = $1', [f.courseId]],
        ['lessons', 'id = $1', [f.lessonId]],
        ['quizzes', 'id = $1', [f.quizId]],
        ['questions', 'id = $1', [f.questionId]],
        ['course_versions', 'id = $1', [f.courseVersionId]],
        ['documents', 'id = $1', [f.documentId]],
        ['document_versions', 'id = $1', [f.documentVersionId]],
        ['enrollments', 'id = ANY($1)', [[f.enrollmentId, f.multiEnrollmentId]]],
        ['quiz_attempts', 'id = $1', [f.attemptId]],
        ['certificates', 'id = $1', [f.certificateId]],
        ['invites', 'id = $1', [f.inviteId]],
        ['notification_events', 'id = $1', [f.notificationEventId]],
        ['email_messages', 'id = $1', [f.emailMessageId]],
        ['cycle_summary_runs', 'id = $1', [f.cycleRunId]],
      ];
      for (const [table, where, params] of gone) {
        expect(
          await count(client, `SELECT COUNT(*) n FROM ${table} WHERE ${where}`, params),
          `${table} rows should be gone`,
        ).toBe(0);
      }

      // Every user survives; the multi-org person keeps ONLY the other membership.
      const people = [f.owner, f.author, f.learner, f.multi];
      expect(
        await count(client, `SELECT COUNT(*) n FROM users WHERE id = ANY($1)`, [
          people.map((p) => p.userId),
        ]),
      ).toBe(4);
      expect(
        await count(
          client,
          `SELECT COUNT(*) n FROM organization_users WHERE user_id = $1 AND organization_id = $2 AND active = true`,
          [f.multi.userId, f.otherOrgId],
        ),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM organization_users WHERE user_id = $1`, [
          f.multi.userId,
        ]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM organizations WHERE id = $1`, [f.otherOrgId]),
      ).toBe(1);
      const { rows: hint } = await client.query(
        `SELECT last_active_organization_id FROM users WHERE id = $1`,
        [f.multi.userId],
      );
      expect(hint[0].last_active_organization_id).toBeNull();

      // The audit row survives with ids and counts only.
      const { rows: auditRows } = await client.query(
        `SELECT action, target_type, target_id, organization_id, actor_role, metadata
           FROM audit_logs WHERE action = 'system.org.hard_delete' AND target_id = $1`,
        [f.orgId],
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        target_type: 'organization',
        organization_id: f.orgId,
        actor_role: 'system_admin',
      });
      expect(auditRows[0].metadata).toMatchObject({
        mode: 'hard',
        memberships: 4,
        courses: 1,
        enrollments: 2,
        certificates: 1,
        quizAttempts: 1,
        documents: 1,
        invites: 1,
        subscription: { outcome: 'none' },
      });
      const auditJson = JSON.stringify(auditRows[0]).toLowerCase();
      expect(auditJson).not.toContain(f.orgName.toLowerCase());
      expect(auditJson).not.toContain(f.learner.email.toLowerCase());
      expect(auditJson).not.toContain('lena');

      // The slug is free again.
      await insertOrg(client, crypto.randomUUID(), f.orgName, f.slug, f.owner.email);
    } finally {
      await client.end();
    }
  });

  test('an organization another organization depends on is refused with the exact message and nothing is deleted', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const f = await seedFixture();
    fixtures.push(f);

    // A member of the OTHER organization is enrolled in this organization's course.
    const foreign = person(f.slug, 'foreign');
    const setup = await db();
    try {
      await insertUser(setup, foreign, ['Fay', 'Foreign']);
      await insertMembership(setup, f.otherOrgId, foreign, 'nurse');
      await setup.query(
        `INSERT INTO enrollments (id, organization_user_id, course_id, status, progress, started_at)
         VALUES ($1, $2, $3, 'in_progress'::"EnrollmentStatus", 5, NOW())`,
        [crypto.randomUUID(), foreign.orgUserId, f.courseId],
      );
    } finally {
      await setup.end();
    }
    await softDeleteInDb(f.orgId);

    await loginAsSystemAdmin(page);
    await page.goto(`/system/organizations/${f.orgId}`);
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Permanently delete organization' }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      dialog.getByText(
        "Other organizations use this organization's courses or data (1 enrollment(s)). Permanently deleting would destroy their records, so it is refused.",
      ),
    ).toBeVisible();
    await expect(dialog.getByLabel('Type the organization name to confirm:')).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();

    const client = await db();
    try {
      expect(
        await count(client, `SELECT COUNT(*) n FROM organizations WHERE id = $1`, [f.orgId]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM courses WHERE id = $1`, [f.courseId]),
      ).toBe(1);
      expect(
        await count(client, `SELECT COUNT(*) n FROM certificates WHERE id = $1`, [f.certificateId]),
      ).toBe(1);
      expect(
        await count(
          client,
          `SELECT COUNT(*) n FROM audit_logs WHERE action = 'system.org.hard_delete' AND target_id = $1`,
          [f.orgId],
        ),
      ).toBe(0);
    } finally {
      await client.end();
    }
  });
});
