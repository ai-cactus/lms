/**
 * E2E spec: the admin content-edit affordance in the learn player (fix PR
 * #649, "stop offering 'Edit Article' to viewers who can never save").
 *
 * `getLearnPayload` (src/lib/learn/get-learn-payload.ts) exposes TWO server
 * verdicts to the client, and this spec exists to keep them from collapsing
 * back into one:
 *
 *   - `isAdminView` — may this role open a course read-only, with no
 *     enrollment (`mayReviewWithoutEnrollment`: `isAdminRole` + `course.read`)?
 *   - `canEditContent` — may this role actually SAVE a change
 *     (`mayEditCourseContent`: `course.edit` AND the caller's organisation
 *     owns the course), the exact predicate `updateLessonContent` re-checks on
 *     every call.
 *
 * Before the fix, `AdminLessonEditor` rendered its "Edit Article" button off
 * `isAdminView` alone, so a Supervisor (who holds `course.read` but not
 * `course.edit`) or an admin previewing another org's course before adopting
 * it (read is granted for a published global course, but `course.edit` is
 * still scoped to the owning organisation) saw a save control that
 * `updateLessonContent` would always refuse — and because a thrown Server
 * Action message is redacted to React error #441 in production, the refusal
 * arrived with no explanation at all.
 *
 * Three cases, matching the distinct populations the gate separates:
 *
 *   1. HR, own-organisation course — POSITIVE CONTROL. Sees "Edit Article",
 *      can open it, change the content, save, and the change survives a
 *      reload. This is the case that proves the control still exists at all:
 *      without it, a regression that hid the button from EVERY role would
 *      pass every absence assertion below.
 *   2. Supervisor, the SAME course — holds `course.read` (so the review
 *      renders) but not `course.edit` (founder-matrix row: Supervisor is
 *      "READ-ONLY on documents, courses, staff and audits", permissions.ts's
 *      `supervisor` block has no `course.edit`). "Edit Article" must be
 *      absent.
 *   3. A second organisation's Owner opening a PUBLISHED GLOBAL course they
 *      do not own — `isGlobalCatalog` grants the read-only review
 *      (get-learn-payload.ts's `isSameOrg || isGlobalCatalog` branch), but
 *      `mayEditCourseContent`'s organisation-ownership half fails. "Edit
 *      Article" must be absent even though this viewer's role otherwise
 *      holds `course.edit` in their own org.
 *
 * Both courses are TEXT courses (no `videoStorageUri`): a video course routes
 * admins to `AdminCourseReview` instead, a separate read-only component with
 * no edit control of its own — not the surface this fix touched.
 *
 * Both org's owners are seeded so `createdByOrgUserId` (a NOT NULL FK) has an
 * owner to point at; neither owner logs in — only HR, Supervisor and the
 * second org's Owner do, since those are the three roles the gate actually
 * separates.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@learn-edit-affordance-e2e.invalid`;
}

interface Seeded {
  orgAId: string;
  facilityAId: string;
  ownerAId: string;
  ownerAOrgUserId: string;
  hrId: string;
  hrOrgUserId: string;
  hrEmail: string;
  hrPassword: string;
  supervisorId: string;
  supervisorOrgUserId: string;
  supervisorEmail: string;
  supervisorPassword: string;
  ownOrgCourseId: string;
  ownOrgLessonId: string;
  orgBId: string;
  facilityBId: string;
  ownerBId: string;
  ownerBOrgUserId: string;
  ownerBEmail: string;
  ownerBPassword: string;
  globalCourseId: string;
  globalLessonId: string;
}

const ORIGINAL_LESSON_CONTENT = '<p>Original lesson content.</p>';

async function seedOrgWithSubscription(
  client: Client,
  slug: string,
  primaryEmail: string,
): Promise<{ orgId: string; facilityId: string }> {
  const orgId = crypto.randomUUID();
  const facilityId = crypto.randomUUID();

  await client.query(
    `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
    [orgId, `Learn Edit Affordance E2E ${slug}`, slug, primaryEmail],
  );
  await client.query(
    `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
     VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
    [facilityId, orgId, `Learn Edit Affordance Facility ${slug}`],
  );
  // Every raw-seeded org needs an active subscription row — several
  // admin-dashboard flows (billing-paused banner, seat/plan checks) treat a
  // missing row as an inactive org.
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await client.query(
    `INSERT INTO subscriptions (
       id, organization_id, stripe_subscription_id, stripe_price_id, plan,
       billing_cycle, status, current_period_start, current_period_end,
       cancel_at_period_end, paused_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
       'active'::"SubscriptionStatus", $5, $6, false, NULL, NOW(), NOW())`,
    [
      crypto.randomUUID(),
      orgId,
      `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
      `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
      periodStart,
      periodEnd,
    ],
  );

  return { orgId, facilityId };
}

async function seedOrgUser(
  client: Client,
  params: {
    orgId: string;
    facilityId: string;
    role: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
): Promise<{ userId: string; orgUserId: string }> {
  const userId = crypto.randomUUID();
  const orgUserId = crypto.randomUUID();
  const hashed = await bcrypt.hash(params.password, 10);
  const fullName = `${params.firstName} ${params.lastName}`;

  await client.query(
    `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
     VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
    [userId, params.email, hashed, params.firstName, params.lastName, fullName],
  );
  await client.query(
    `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
    [orgUserId, userId, params.orgId, params.role],
  );
  await client.query(
    `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
     VALUES ($1, $2, $3, true, NOW())`,
    [crypto.randomUUID(), orgUserId, params.facilityId],
  );

  return { userId, orgUserId };
}

async function seedCourseWithLesson(
  client: Client,
  params: {
    orgId: string;
    creatorOrgUserId: string;
    title: string;
    isGlobal: boolean;
  },
): Promise<{ courseId: string; lessonId: string }> {
  const courseId = crypto.randomUUID();
  const lessonId = crypto.randomUUID();

  await client.query(
    `INSERT INTO courses (
       id, title, description, status, created_by_org_user_id, organization_id,
       type, is_global, review_required, created_at, updated_at
     ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", $6, false, NOW(), NOW())`,
    [
      courseId,
      params.title,
      'A course seeded to exercise the learn-player admin edit affordance.',
      params.creatorOrgUserId,
      params.orgId,
      params.isGlobal,
    ],
  );
  await client.query(
    `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
     VALUES ($1, $2, 'Module 1', $3, 0, 'ready'::"MediaStatus", NOW(), NOW())`,
    [lessonId, courseId, ORIGINAL_LESSON_CONTENT],
  );

  return { courseId, lessonId };
}

async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const slug = `learn-edit-${crypto.randomBytes(4).toString('hex')}`;

    const orgA = await seedOrgWithSubscription(client, `${slug}-a`, uid('org-a'));
    const ownerA = await seedOrgUser(client, {
      orgId: orgA.orgId,
      facilityId: orgA.facilityId,
      role: 'owner',
      email: uid('owner-a'),
      password: 'unused-not-logged-in',
      firstName: 'OrgA',
      lastName: 'Owner',
    });

    const hrPassword = 'LearnEditHr!9';
    const hrEmail = uid('hr');
    const hr = await seedOrgUser(client, {
      orgId: orgA.orgId,
      facilityId: orgA.facilityId,
      role: 'hr',
      email: hrEmail,
      password: hrPassword,
      firstName: 'Learn',
      lastName: 'Hr',
    });

    const supervisorPassword = 'LearnEditSupervisor!9';
    const supervisorEmail = uid('supervisor');
    const supervisor = await seedOrgUser(client, {
      orgId: orgA.orgId,
      facilityId: orgA.facilityId,
      role: 'supervisor',
      email: supervisorEmail,
      password: supervisorPassword,
      firstName: 'Learn',
      lastName: 'Supervisor',
    });

    const ownOrgCourse = await seedCourseWithLesson(client, {
      orgId: orgA.orgId,
      creatorOrgUserId: ownerA.orgUserId,
      title: `Own-Org Course ${slug}`,
      isGlobal: false,
    });

    const orgB = await seedOrgWithSubscription(client, `${slug}-b`, uid('org-b'));
    const ownerBPassword = 'LearnEditOwnerB!9';
    const ownerBEmail = uid('owner-b');
    const ownerB = await seedOrgUser(client, {
      orgId: orgB.orgId,
      facilityId: orgB.facilityId,
      role: 'owner',
      email: ownerBEmail,
      password: ownerBPassword,
      firstName: 'OrgB',
      lastName: 'Owner',
    });

    // Global catalogue course, still owned/created by org A — org B's owner
    // gets read access via `isGlobalCatalog`, never via `isSameOrg`.
    const globalCourse = await seedCourseWithLesson(client, {
      orgId: orgA.orgId,
      creatorOrgUserId: ownerA.orgUserId,
      title: `Global Catalogue Course ${slug}`,
      isGlobal: true,
    });

    return {
      orgAId: orgA.orgId,
      facilityAId: orgA.facilityId,
      ownerAId: ownerA.userId,
      ownerAOrgUserId: ownerA.orgUserId,
      hrId: hr.userId,
      hrOrgUserId: hr.orgUserId,
      hrEmail,
      hrPassword,
      supervisorId: supervisor.userId,
      supervisorOrgUserId: supervisor.orgUserId,
      supervisorEmail,
      supervisorPassword,
      ownOrgCourseId: ownOrgCourse.courseId,
      ownOrgLessonId: ownOrgCourse.lessonId,
      orgBId: orgB.orgId,
      facilityBId: orgB.facilityId,
      ownerBId: ownerB.userId,
      ownerBOrgUserId: ownerB.orgUserId,
      ownerBEmail,
      ownerBPassword,
      globalCourseId: globalCourse.courseId,
      globalLessonId: globalCourse.lessonId,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    const courseIds = [seeded.ownOrgCourseId, seeded.globalCourseId];
    const orgUserIds = [
      seeded.ownerAOrgUserId,
      seeded.hrOrgUserId,
      seeded.supervisorOrgUserId,
      seeded.ownerBOrgUserId,
    ];
    const userIds = [seeded.ownerAId, seeded.hrId, seeded.supervisorId, seeded.ownerBId];

    await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1)`, [courseIds]);
    await client.query(`DELETE FROM lessons WHERE course_id = ANY($1)`, [courseIds]);
    await client.query(`DELETE FROM courses WHERE id = ANY($1)`, [courseIds]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = ANY($1)`, [
      [seeded.orgAId, seeded.orgBId],
    ]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    // Deleted by exact id, never by the shared email-suffix LIKE pattern: this
    // spec's tests run concurrently under Playwright's default worker count,
    // each seeding its own orgs with the SAME email suffix — a wildcard
    // DELETE here would tear down another still-running test's rows.
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM facilities WHERE id = ANY($1)`, [
      [seeded.facilityAId, seeded.facilityBId],
    ]);
    await client.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [seeded.orgAId, seeded.orgBId],
    ]);
  } finally {
    await client.end();
  }
}

async function loginAsAdmin(page: Page, email: string, password: string): Promise<void> {
  // Random per-login IP so parallel/sequential runs don't share the
  // credential-layer rate-limit bucket (same convention as course.spec.ts /
  // video-playback.spec.ts).
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

test.describe('Learn player — admin "Edit Article" affordance (PR #649)', () => {
  test("HR, viewing their own organisation's course, can edit and the change survives a reload — positive control", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seeded = await seedFixture();

    try {
      await loginAsAdmin(page, seeded.hrEmail, seeded.hrPassword);

      await page.goto(`/learn/${seeded.ownOrgCourseId}`);
      await page.waitForLoadState('networkidle');

      const editButton = page.getByRole('button', { name: 'Edit Article' });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();

      const editor = page.locator('.ql-editor');
      await expect(editor).toBeVisible({ timeout: 10000 });
      const updatedContent = `HR-edited content ${crypto.randomBytes(4).toString('hex')}`;
      // `fill()` (supported on `[contenteditable]`) replaces the whole content
      // in one action. Quill re-renders its controlled `value` on every
      // keystroke (AdminLessonEditor's onChange -> setState), so typing the
      // content character-by-character races that re-render and drops all but
      // the first character.
      await editor.fill(updatedContent);

      await page.getByRole('button', { name: 'Save Changes' }).click();
      // The editor drops back to read mode once the save resolves — waiting
      // for "Edit Article" to reappear is the observable proof the save
      // completed, without depending on any particular success toast copy.
      await expect(page.getByRole('button', { name: 'Edit Article' })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText('Something went wrong while saving.')).toHaveCount(0);

      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(updatedContent)).toBeVisible({ timeout: 15000 });
    } finally {
      await cleanup(seeded);
    }
  });

  test('Supervisor sees the read-only course review but never "Edit Article" — holds course.read, not course.edit', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedFixture();

    try {
      await loginAsAdmin(page, seeded.supervisorEmail, seeded.supervisorPassword);

      await page.goto(`/learn/${seeded.ownOrgCourseId}`);
      await page.waitForLoadState('networkidle');

      // Anchor on the review actually having rendered, so the absence below is
      // a real absence and not an unloaded/blocked page.
      await expect(page.getByText(ORIGINAL_LESSON_CONTENT.replace(/<\/?p>/g, ''))).toBeVisible({
        timeout: 15000,
      });
      // Deliberately withheld, not unbuilt: permissions.ts's `supervisor`
      // block is `readEverythingExceptBilling` plus a short, explicit list of
      // extra write verbs (assignment.*, enrollment.create,
      // certificate.create) that does NOT include `course.edit` — the
      // founder-matrix description for this role is "READ-ONLY on documents,
      // courses, staff and audits". `mayEditCourseContent` refuses on that
      // permission check alone, so this is the fix's own contract, not a gap.
      await expect(page.getByRole('button', { name: 'Edit Article' })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });

  test('an org admin previewing a published global-catalogue course they do not own sees no "Edit Article"', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedFixture();

    try {
      await loginAsAdmin(page, seeded.ownerBEmail, seeded.ownerBPassword);

      await page.goto(`/learn/${seeded.globalCourseId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(ORIGINAL_LESSON_CONTENT.replace(/<\/?p>/g, ''))).toBeVisible({
        timeout: 15000,
      });
      // Owner holds `course.edit` in general (permissions.ts: `everything`),
      // so this absence is entirely `mayEditCourseContent`'s ORGANISATION half:
      // the course's `creator.organizationId` is org A, this viewer's is org
      // B. `isGlobalCatalog` grants the read-only review; it never grants a
      // save right over a course this org does not own.
      await expect(page.getByRole('button', { name: 'Edit Article' })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
