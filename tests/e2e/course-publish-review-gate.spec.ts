/**
 * E2E spec: Issue #14 (F-051 publish-review gate) observable-state coverage,
 * plus the direct-assign bypass this testing effort surfaced and fixed
 * (commit 523c33a).
 *
 * Background: `createFullCourse` computes `reviewRequired` SERVER-SIDE from
 * the AI generation artifacts, and Steps 6-8 of the course wizard need a real
 * Vertex AI call this environment has no credentials for — the established
 * constraint documented in course-wizard-module-builder.spec.ts's own
 * docstring, which this spec follows. Naturally reaching `reviewRequired:
 * true` therefore requires a live degraded generation, which cannot be driven
 * here; the full defer/replay/idempotency state machine (createFullCourse ->
 * pendingAssignment -> publishCourse's acknowledge-and-replay) is exhaustively
 * covered at the unit level instead — see course.deferred-assignment.test.ts
 * and pending-assignment.test.ts.
 *
 * What THIS spec covers, DB-seeding a held draft directly to stand in for a
 * degraded generation's output (the same technique
 * course-wizard-module-builder.spec.ts uses to sidestep the AI dependency):
 *
 *   1. A `reviewRequired` draft renders "Needs Review" on its training-details
 *      page (Issue #13, exercised through a real browser render) — never the
 *      old hardcoded "Active" — and has sent no email and created no
 *      enrollment for the assignment its (fictitious) creation parked.
 *
 *   2. The bypass this testing effort found: `/dashboard/training/courses/
 *      [id]/assign` (AssignPublishClient) is reachable for a held draft
 *      regardless of `reviewRequired`, and used to call `enrollUsers`
 *      directly with no gate at all — enrolling AND emailing learners about a
 *      course that had not been reviewed, precisely what Issue #14 exists to
 *      prevent. `enrollUsers`/`assignCourseToRole` (src/app/actions/
 *      enrollment.ts) now refuse with an explicit error when
 *      `course.reviewRequired` is true. This is the live regression guard for
 *      that fix.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - MailHog running on http://localhost:8025 (or MAILHOG_URL).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';
const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@publish-review-gate-e2e.invalid`;
}

async function searchMailHog(email: string): Promise<unknown[]> {
  const res = await fetch(
    `${MAILHOG_URL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`,
  );
  if (!res.ok) throw new Error(`MailHog search failed: ${res.status}`);
  const data = (await res.json()) as { items: unknown[] };
  return data.items ?? [];
}

interface Seeded {
  orgId: string;
  facilityId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  courseId: string;
}

/**
 * Seed an org (active billing) + owner + a course held by the F-051 gate: a
 * draft, `reviewRequired: true`, with a `pendingAssignment` parked for
 * `parkedEmail` — the exact shape `createFullCourse` would have written for a
 * degraded generation whose wizard assign & publish step targeted that email
 * (Issue #14).
 */
async function seedHeldDraftCourse(parkedEmail: string): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'PublishGateOwner!9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const slug = `publish-gate-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Publish Review Gate E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Publish Review Gate Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Gate', 'Owner', 'Gate Owner', NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityId],
    );

    const subNow = new Date();
    const subPeriodEnd = new Date(subNow);
    subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
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
        subNow,
        subPeriodEnd,
      ],
    );

    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, type, is_global,
         review_required, quality_warnings, pending_assignment, created_at, updated_at
       ) VALUES ($1, $2, $3, 'draft'::"CourseStatus", $4, 'text'::"CourseType", false,
         true, $5, $6, NOW(), NOW())`,
      [
        courseId,
        `Publish Review Gate E2E Course ${slug}`,
        'A degraded course held for review.',
        ownerOrgUserId,
        ['No slides were generated for this course.'],
        JSON.stringify({ mode: 'email', emails: [parkedEmail], dueAt: null }),
      ],
    );

    return { orgId, facilityId, ownerId, ownerOrgUserId, ownerEmail, ownerPassword, courseId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM course_assignments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM invite_course_assignments WHERE course_id = $1`, [
      seeded.courseId,
    ]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.ownerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.ownerOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function loginAsOwner(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

test.describe('F-051 publish-review gate — held-draft observable state (Issue #13/#14)', () => {
  test('a held draft shows "Needs Review" (never "Active"), and its parked assignment sent no email and created no enrollment', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const parkedEmail = uid('parked');
    const seeded = await seedHeldDraftCourse(parkedEmail);

    try {
      await loginAsOwner(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard/training/courses/${seeded.courseId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Needs Review')).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Active', { exact: true })).toHaveCount(0);

      // Core regression guard: the intent createFullCourse would have parked
      // for `parkedEmail` never fired an email or an enrollment.
      const mail = await searchMailHog(parkedEmail);
      expect(mail).toHaveLength(0);

      const client = await db();
      try {
        const enrollments = await client.query(`SELECT id FROM enrollments WHERE course_id = $1`, [
          seeded.courseId,
        ]);
        expect(enrollments.rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('a direct assign attempt against a held draft is refused — the review-gate bypass regression guard (fix 523c33a)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const parkedEmail = uid('parked');
    const seeded = await seedHeldDraftCourse(parkedEmail);
    const bypassAttemptEmail = uid('bypass-target');

    try {
      await loginAsOwner(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard/training/courses/${seeded.courseId}/assign`);
      await page.waitForLoadState('networkidle');

      await page.locator('#assign-input').fill(bypassAttemptEmail);
      await page.getByRole('button', { name: 'Invite' }).click();
      await expect(page.getByText(bypassAttemptEmail).first()).toBeVisible();

      // Still a draft (never published), so the CTA reads "Publish Course".
      await page.getByRole('button', { name: /publish course/i }).click();

      await expect(
        page.getByText(/quality warnings and requires review before it can be assigned/i),
      ).toBeVisible({ timeout: 15000 });
      // The success dialog this used to fall through to must never appear.
      await expect(page.getByText('Course Assigned Successfully')).toHaveCount(0);

      const mail = await searchMailHog(bypassAttemptEmail);
      expect(mail).toHaveLength(0);

      const client = await db();
      try {
        const enrollments = await client.query(`SELECT id FROM enrollments WHERE course_id = $1`, [
          seeded.courseId,
        ]);
        expect(enrollments.rows).toHaveLength(0);
        const invites = await client.query(
          `SELECT id FROM invites WHERE organization_id = $1 AND email = $2`,
          [seeded.orgId, bypassAttemptEmail],
        );
        expect(invites.rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
