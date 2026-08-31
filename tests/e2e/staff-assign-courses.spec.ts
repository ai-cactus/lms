/**
 * E2E spec: staff-profile "Assign Course" flow (course-creation-wizard
 * redesign wave, new this session) — AssignCoursesModal.tsx, driven from
 * StaffProfileClient's header button and backed by assignCoursesToStaffMember
 * (src/app/actions/staff.ts).
 *
 * This flow needs no AI generation — it only assigns already-published
 * courses to an existing staff member — so it is fully drivable end-to-end
 * in this environment, unlike the wizard's generation steps (6-7-8).
 *
 * Acceptance criteria:
 *   - An owner (assignment.create) opens "Assign Course" from a staff
 *     member's profile, picks a course from the Video Courses tab, sets a
 *     completion deadline via a suggested preset, confirms, and the modal
 *     reports success — the assignment persists as an `enrollments` row.
 *   - Switching to the Reading Courses tab shows the reading (text) course
 *     and hides the video one, keyed off `course.type`.
 *   - A read-only role (supervisor, lacks assignment.create) never sees the
 *     "Assign Course" button on the same profile.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for direct DB seeding + assertions.
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

interface Seeded {
  orgId: string;
  facilityId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  staffUserId: string;
  staffOrgUserId: string;
  staffFullName: string;
  videoCourseId: string;
  videoCourseTitle: string;
  readingCourseId: string;
  readingCourseTitle: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@staff-assign-e2e.invalid`;
}

async function seedFixture(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'StaffAsn!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const staffEmail = uid('staff');
    const staffHashed = await bcrypt.hash('StaffAsn!Worker9', 10);
    const slug = `staff-assign-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const staffUserId = crypto.randomUUID();
    const staffOrgUserId = crypto.randomUUID();
    const staffFullName = 'Avery Assignee';
    const videoCourseId = crypto.randomUUID();
    const readingCourseId = crypto.randomUUID();
    const videoCourseTitle = `Assign Video Course ${slug}`;
    const readingCourseTitle = `Assign Reading Course ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Staff Assign E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Staff Assign Facility ${slug}`],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Assign', 'Owner', 'Assign Owner', NOW(), NOW())`,
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

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Avery', 'Assignee', $4, NOW(), NOW())`,
      [staffUserId, staffEmail, staffHashed, staffFullName],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [staffOrgUserId, staffUserId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), staffOrgUserId, facilityId],
    );

    // Active subscription: enrollUsers' billing gate (enrollment.ts) requires
    // it, same as assign-course-invite.spec.ts and worker-billing-gate.spec.ts.
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

    // getCourses() (src/app/actions/course.ts) returns courses the caller's
    // OWN membership created — no org_course_offerings row needed since the
    // owner both creates and views these.
    await client.query(
      `INSERT INTO courses (id, title, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'video'::"CourseType", false, NOW(), NOW())`,
      [videoCourseId, videoCourseTitle, ownerOrgUserId],
    );
    await client.query(
      `INSERT INTO courses (id, title, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'text'::"CourseType", false, NOW(), NOW())`,
      [readingCourseId, readingCourseTitle, ownerOrgUserId],
    );

    return {
      orgId,
      facilityId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      staffUserId,
      staffOrgUserId,
      staffFullName,
      videoCourseId,
      videoCourseTitle,
      readingCourseId,
      readingCourseTitle,
    };
  } finally {
    await client.end();
  }
}

async function addSupervisor(seeded: Seeded, email: string, password: string): Promise<string> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Sup', 'Ervisor', 'Sup Ervisor', NOW(), NOW())`,
      [userId, email, hashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'supervisor'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, seeded.orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, seeded.facilityId],
    );
    return orgUserId;
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded, extraOrgUserIds: string[] = []): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1)`, [
      [seeded.videoCourseId, seeded.readingCourseId],
    ]);
    await client.query(`DELETE FROM courses WHERE id = ANY($1)`, [
      [seeded.videoCourseId, seeded.readingCourseId],
    ]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    const allOrgUserIds = [seeded.ownerOrgUserId, seeded.staffOrgUserId, ...extraOrgUserIds];
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [allOrgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [allOrgUserIds]);
    await client.query(`DELETE FROM users WHERE id = $1 OR id = $2`, [
      seeded.ownerId,
      seeded.staffUserId,
    ]);
    if (extraOrgUserIds.length > 0) {
      await client.query(
        `DELETE FROM users WHERE id IN (SELECT user_id FROM organization_users WHERE id = ANY($1))`,
        [extraOrgUserIds],
      );
    }
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Staff profile — Assign Course flow', () => {
  test('owner assigns a video course with a suggested deadline preset, and it persists as an enrollment', async ({
    page,
  }) => {
    const seeded = await seedFixture();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: seeded.staffFullName })).toBeVisible();
      await page.getByRole('button', { name: 'Assign Course' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Assign Courses')).toBeVisible();

      // Defaults to the Video Courses tab.
      await expect(dialog.getByRole('tab', { name: 'Video Courses' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(dialog.getByText(seeded.videoCourseTitle)).toBeVisible();
      await expect(dialog.getByText(seeded.readingCourseTitle)).not.toBeVisible();

      await dialog.getByRole('checkbox', { name: seeded.videoCourseTitle }).click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();

      // Deadline step — use a suggested preset rather than the calendar popover.
      await expect(dialog.getByText('Set Completion Deadline')).toBeVisible();
      await dialog.getByRole('button', { name: '30 days' }).click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();

      // Success step.
      await expect(dialog.getByText('Courses Assigned Successfully')).toBeVisible();
      await expect(
        dialog.getByText(new RegExp(`${seeded.staffFullName}.*assigned to 1 course`, 'i')),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      const client = await db();
      try {
        const result = await client.query(
          `SELECT status, due_at FROM enrollments WHERE organization_user_id = $1 AND course_id = $2`,
          [seeded.staffOrgUserId, seeded.videoCourseId],
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].status).toBe('enrolled');
        expect(result.rows[0].due_at).not.toBeNull();
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('the Reading Courses tab filters to text-type courses only', async ({ page }) => {
    const seeded = await seedFixture();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Assign Course' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('tab', { name: 'Reading Courses' }).click();
      await expect(dialog.getByText(seeded.readingCourseTitle)).toBeVisible();
      await expect(dialog.getByText(seeded.videoCourseTitle)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('a read-only supervisor never sees the Assign Course button on a staff profile', async ({
    page,
  }) => {
    const seeded = await seedFixture();
    const supervisorEmail = uid('supervisor');
    const supervisorPassword = 'StaffAsn!Sup9x';
    const supervisorOrgUserId = await addSupervisor(seeded, supervisorEmail, supervisorPassword);
    try {
      await login(page, supervisorEmail, supervisorPassword);
      await page.goto(`/dashboard/staff/${seeded.staffOrgUserId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: seeded.staffFullName })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Assign Course' })).not.toBeVisible();
    } finally {
      await cleanup(seeded, [supervisorOrgUserId]);
    }
  });
});
