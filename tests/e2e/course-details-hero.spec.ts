/**
 * E2E spec for the course-details hero (PR-4 of the course-creation redesign).
 *
 * Two things this spec exists to guard:
 *
 *   1. "View Course" must open THIS course, not some other one. Commit
 *      b88331f fixed the exact same regression shape on this page's "Go Back"
 *      link that morning (a link whose target silently didn't track the
 *      course being viewed), so this drives TWO distinct courses in one run
 *      and asserts each "View Course" click resolves to its OWN id — a test
 *      against only one course could not have caught that class of bug.
 *
 *   2. The D10 attribution line for both reachable states: `approvedBy`
 *      populated (D8 — a reviewer confirmed the publish) and `approvedBy`
 *      null (D9 — `publishCourseOnAssignment` published the course as a side
 *      effect of being assigned, with no reviewer recorded).
 *
 * Both course rows are seeded directly in the DB with the DB state each path
 * produces, rather than driven through the wizard/confirm-modal UI: course
 * generation needs live Vertex AI credentials this environment does not have
 * (the same constraint course-publish-review-gate.spec.ts documents), and the
 * attribution line is pure rendering off `approvedByOrgUserId` — the fixture
 * only needs to reproduce the COLUMN STATE each path leaves behind, not the
 * generation pipeline that got there.
 *
 * Locator note: the hero has TWO links whose accessible names both contain
 * "Course" ("View Course" and, via the breadcrumb "Course / Course Details"
 * text, unrelated but adjacent) — plus "Preview" as a separate ghost link.
 * Use `exact: true` for "View Course" so it never partial-matches something
 * else, per code-ninja's implementation note.
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
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@course-details-hero-e2e.invalid`;
}

interface Seeded {
  orgId: string;
  facilityId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName: string;
  reviewerId: string;
  reviewerOrgUserId: string;
  reviewerFullName: string;
  /** D8 path: approvedByOrgUserId set to the reviewer. */
  approvedCourseId: string;
  approvedCourseTitle: string;
  /** D9 path: approvedByOrgUserId left null (published by assignment). */
  assignedCourseId: string;
  assignedCourseTitle: string;
}

async function seedTwoCourses(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'HeroE2eOwner!9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const ownerFullName = 'Hero Owner';
    const reviewerEmail = uid('reviewer');
    const reviewerFullName = 'Hero Reviewer';
    const slug = `course-hero-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const reviewerId = crypto.randomUUID();
    const reviewerOrgUserId = crypto.randomUUID();
    const approvedCourseId = crypto.randomUUID();
    const assignedCourseId = crypto.randomUUID();
    const approvedCourseTitle = `Approved Path Course ${slug}`;
    const assignedCourseTitle = `Assigned Path Course ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Course Hero E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Course Hero Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Hero', 'Owner', $4, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, ownerFullName],
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

    // A second membership to act as the D8 publish reviewer, distinct from the
    // course creator — otherwise "Approved by" and "Created by" would name the
    // same person and the two branches couldn't be told apart.
    const reviewerHashed = await bcrypt.hash('unused-not-logged-in', 10);
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Hero', 'Reviewer', $4, NOW(), NOW())`,
      [reviewerId, reviewerEmail, reviewerHashed, reviewerFullName],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'admin'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [reviewerOrgUserId, reviewerId, orgId],
    );

    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, approved_by_org_user_id,
         approved_at, type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, NOW(), 'text'::"CourseType", false, false, NOW(), NOW())`,
      [
        approvedCourseId,
        approvedCourseTitle,
        'A course confirmed through the publish review modal.',
        ownerOrgUserId,
        reviewerOrgUserId,
      ],
    );
    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, approved_by_org_user_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, NULL, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [
        assignedCourseId,
        assignedCourseTitle,
        'A clean draft published as a side effect of being assigned.',
        ownerOrgUserId,
      ],
    );

    return {
      orgId,
      facilityId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      ownerFullName,
      reviewerId,
      reviewerOrgUserId,
      reviewerFullName,
      approvedCourseId,
      approvedCourseTitle,
      assignedCourseId,
      assignedCourseTitle,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1)`, [
      [seeded.approvedCourseId, seeded.assignedCourseId],
    ]);
    await client.query(`DELETE FROM courses WHERE id = ANY($1)`, [
      [seeded.approvedCourseId, seeded.assignedCourseId],
    ]);
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.ownerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [
      [seeded.ownerOrgUserId, seeded.reviewerOrgUserId],
    ]);
    // Deleted by exact id, never by the shared email-suffix LIKE pattern: this
    // spec's own tests run concurrently under Playwright's default worker
    // count, each seeding its own org with the SAME suffix — a wildcard DELETE
    // here would tear down another still-running test's rows and surface as a
    // spurious FK violation, not a real regression.
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [seeded.ownerId, seeded.reviewerId],
    ]);
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

test.describe('Course details hero — "View Course" targeting and D10 attribution', () => {
  test('"View Course" opens the correct, own course for two distinct courses in one run', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedTwoCourses();

    try {
      await loginAsOwner(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard/training/courses/${seeded.approvedCourseId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('link', { name: 'View Course', exact: true }).click();
      await page.waitForURL(`**/learn/${seeded.approvedCourseId}`, { timeout: 15000 });
      await expect(page).toHaveURL(new RegExp(`/learn/${seeded.approvedCourseId}$`));

      await page.goto(`/dashboard/training/courses/${seeded.assignedCourseId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('link', { name: 'View Course', exact: true }).click();
      await page.waitForURL(`**/learn/${seeded.assignedCourseId}`, { timeout: 15000 });
      await expect(page).toHaveURL(new RegExp(`/learn/${seeded.assignedCourseId}$`));
    } finally {
      await cleanup(seeded);
    }
  });

  test('shows "Approved by: {reviewer} (Admin)" for a course confirmed through the review modal (D8)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedTwoCourses();

    try {
      await loginAsOwner(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard/training/courses/${seeded.approvedCourseId}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(`Approved by: ${seeded.reviewerFullName} (Admin)`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(/^Created by:/)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('shows "Created by: {creator} (Owner (Organisation Admin))" for a course published by assignment, no reviewer recorded (D9)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedTwoCourses();

    try {
      await loginAsOwner(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard/training/courses/${seeded.assignedCourseId}`);
      await page.waitForLoadState('networkidle');

      // getRoleDisplayName('owner') -> 'Owner (Organisation Admin)' (the RBAC
      // registry's full display name, not a shortened "Owner").
      await expect(
        page.getByText(`Created by: ${seeded.ownerFullName} (Owner (Organisation Admin))`),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/^Approved by:/)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
