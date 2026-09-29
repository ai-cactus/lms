/**
 * E2E spec: multi-facility v3 increment 2 — the Global (all-facilities)
 * dashboard and its facility-scoped drill-down.
 *
 * Acceptance criteria:
 *   - An org-wide role (owner) with 2+ facilities lands on the Global View
 *     ("Here is an overview across all your facilities"), can click "View
 *     dashboard" for one facility to reach its scoped dashboard (breadcrumb
 *     shows the facility name, copy reads "overview of your facility"), and
 *     the FacilityScopeSwitcher's "All Facilities" option returns to Global.
 *   - A tampered `?facility=<foreign-id>` (belonging to another org, or
 *     simply nonexistent) silently falls back to the Global View rather than
 *     leaking whether that facility exists or erroring.
 *   - A facility's dashboard reports the founder's tiles — Total Active
 *     Courses, Total Assigned Learners, Average Grade (the HIGHEST submitted
 *     score wins) — over the organisation's courses, not the viewer's, and
 *     attributes a transferred member to their CURRENT facility, never to the
 *     facility stamped on their enrolment.
 *   - Finance sees exactly the Owner's tile values for the same scope, never
 *     the Courses table or the Status Tracker, and the Global View once the
 *     organisation has 2+ facilities.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
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

interface Seeded {
  orgId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  facilityAId: string;
  facilityAName: string;
  facilityBId: string;
  facilityBName: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@facility-dash-e2e.invalid`;
}

/** Seed an org with an owner and TWO facilities — the minimum for a Global View. */
async function seedOrgWithTwoFacilities(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'FacDash!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const slug = `facility-dash-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const facilityAId = crypto.randomUUID();
    const facilityBId = crypto.randomUUID();
    const facilityAName = `Alpha Site ${slug}`;
    const facilityBName = `Beta Site ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Facility Dash E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityAId, orgId, facilityAName],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityBId, orgId, facilityBName],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, 'Facility', 'Owner', 'Facility Owner'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityAId],
    );

    return {
      orgId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      facilityAId,
      facilityAName,
      facilityBId,
      facilityBName,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.ownerOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.ownerOrgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityAId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityBId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

interface SeededSingleFacility {
  orgId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  hrId: string;
  hrOrgUserId: string;
  workerId: string;
  workerOrgUserId: string;
  facilityAId: string;
  facilityAName: string;
  courseId: string;
  courseTitle: string;
  /** The worker's BEST submitted score — their earlier 60 must not win. */
  bestScore: number;
}

/**
 * Seed an org with exactly ONE facility and a KNOWN dataset. The course is
 * authored by HR, not the owner who logs in: pre-fix, `getDashboardData`
 * filtered on `createdByOrgUserId = <viewer>`, so the owner saw no courses.
 *
 * The worker's enrolment is UNFINISHED (so the course is "active" and the
 * worker an "assigned learner") and carries two submitted quiz attempts, 60 then
 * 88, so Average Grade proves the highest submitted score wins.
 */
async function seedOrgWithOneFacilityAndKnownData(): Promise<SeededSingleFacility> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'FacDash!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const otherHashed = await bcrypt.hash('FacDash!Other9', 10);
    const slug = `facility-dash-one-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const hrId = crypto.randomUUID();
    const hrOrgUserId = crypto.randomUUID();
    const workerId = crypto.randomUUID();
    const workerOrgUserId = crypto.randomUUID();
    const facilityAId = crypto.randomUUID();
    const facilityAName = `Alpha Site ${slug}`;
    const courseId = crypto.randomUUID();
    const courseTitle = `HR-Authored Course ${slug}`;
    const quizId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Facility Dash One-Facility E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityAId, orgId, facilityAName],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [ownerId, ownerEmail, ownerHashed, 'Facility', 'Owner', 'Facility Owner'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [ownerOrgUserId, ownerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), ownerOrgUserId, facilityAId],
    );

    // HR — the course author. Never logs in and holds no training, so it is not
    // part of the staff population.
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [hrId, uid('hr'), otherHashed, 'HR', 'Author', 'HR Author'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [hrOrgUserId, hrId, orgId],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [workerId, uid('worker'), otherHashed, 'Worker', 'Learner', 'Worker Learner'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [workerOrgUserId, workerId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), workerOrgUserId, facilityAId],
    );

    await client.query(
      `INSERT INTO courses (
         id, title, description, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, $3, 'published'::"CourseStatus", $4, $5, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [courseId, courseTitle, 'A course authored by HR, not the org owner.', hrOrgUserId, orgId],
    );
    await client.query(
      `INSERT INTO quizzes (id, course_id, title, passing_score, allowed_attempts, created_at)
       VALUES ($1, $2, $3, 70, 3, NOW())`,
      [quizId, courseId, `Quiz ${slug}`],
    );
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, 'in_progress'::"EnrollmentStatus", 50, NOW() - interval '2 days')`,
      [enrollmentId, workerOrgUserId, courseId, facilityAId],
    );
    // Two SUBMITTED attempts (time_taken set): 60, then 88. Highest wins.
    for (const [score, daysAgo] of [
      [60, 2],
      [88, 1],
    ] as const) {
      await client.query(
        `INSERT INTO quiz_attempts (id, enrollment_id, quiz_id, answers, score, time_taken, attempt_count, completed_at)
         VALUES ($1, $2, $3, '{}'::jsonb, $4, 120, 1, NOW() - ($5 || ' days')::interval)`,
        [crypto.randomUUID(), enrollmentId, quizId, score, String(daysAgo)],
      );
    }

    return {
      orgId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      hrId,
      hrOrgUserId,
      workerId,
      workerOrgUserId,
      facilityAId,
      facilityAName,
      courseId,
      courseTitle,
      bestScore: 88,
    };
  } finally {
    await client.end();
  }
}

interface SeededTransfer {
  facilityBId: string;
  facilityBName: string;
  movedId: string;
  movedOrgUserId: string;
}

/**
 * A second facility plus a member who TRANSFERRED to it: their enrolment was
 * stamped with facility A when assigned, but they are rostered at B today.
 * Current-roster attribution must count them at B and not at A (BUG-36).
 */
async function addSecondFacilityWithTransferredMember(
  seeded: SeededSingleFacility,
): Promise<SeededTransfer> {
  const client = await db();
  try {
    const facilityBId = crypto.randomUUID();
    const facilityBName = `Beta Site ${crypto.randomBytes(4).toString('hex')}`;
    const movedId = crypto.randomUUID();
    const movedOrgUserId = crypto.randomUUID();

    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityBId, seeded.orgId, facilityBName],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [
        movedId,
        uid('moved'),
        await bcrypt.hash('FacDash!Other9', 10),
        'Moved',
        'Worker',
        'Moved Worker',
      ],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [movedOrgUserId, movedId, seeded.orgId],
    );
    // The A row is retired; B is where they work now.
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at, deactivated_at)
       VALUES ($1, $2, $3, false, NOW() - interval '30 days', NOW() - interval '1 day')`,
      [crypto.randomUUID(), movedOrgUserId, seeded.facilityAId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), movedOrgUserId, facilityBId],
    );
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, started_at)
       VALUES ($1, $2, $3, $4, 'assigned'::"EnrollmentStatus", 0, NOW() - interval '1 day')`,
      [crypto.randomUUID(), movedOrgUserId, seeded.courseId, seeded.facilityAId],
    );

    return { facilityBId, facilityBName, movedId, movedOrgUserId };
  } finally {
    await client.end();
  }
}

const FINANCE_PASSWORD = 'FacDash!Finance9';

interface SeededMember {
  userId: string;
  orgUserId: string;
  email: string;
}

/** A Finance member of the org — org-wide, so bound to facility A like the owner. */
async function addFinanceMember(seeded: SeededSingleFacility): Promise<SeededMember> {
  const client = await db();
  try {
    const email = uid('finance');
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Facility', 'Finance', 'Facility Finance', NOW(), NOW())`,
      [userId, email, await bcrypt.hash(FINANCE_PASSWORD, 10)],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'finance'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, seeded.orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, seeded.facilityAId],
    );
    return { userId, orgUserId, email };
  } finally {
    await client.end();
  }
}

async function removeMember(member: SeededMember): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      member.orgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [member.orgUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [member.userId]);
  } finally {
    await client.end();
  }
}

async function cleanupSingleFacility(
  seeded: SeededSingleFacility,
  transfer: SeededTransfer | null,
) {
  const client = await db();
  try {
    const orgUserIds = [seeded.ownerOrgUserId, seeded.hrOrgUserId, seeded.workerOrgUserId];
    const userIds = [seeded.ownerId, seeded.hrId, seeded.workerId];
    if (transfer) {
      orgUserIds.push(transfer.movedOrgUserId);
      userIds.push(transfer.movedId);
    }
    // quiz_attempts and quizzes cascade from their enrolment and course.
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    if (transfer) {
      await client.query(`DELETE FROM facilities WHERE id = $1`, [transfer.facilityBId]);
    }
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityAId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  // Pre-dismiss the "create your first course" empty-state modal — its overlay
  // would otherwise intercept clicks on the dashboard content.
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Global (multi-facility) dashboard', () => {
  test('owner with 2 facilities lands on the Global View, drills into a facility, and the switcher returns to All Facilities', async ({
    page,
  }) => {
    const seeded = await seedOrgWithTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      // Global View landing state. Both the Priority Risks and Facilities
      // Overview tables render a row per facility, so scope to the Facilities
      // Overview section before addressing a facility's row.
      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
      await expect(page.getByLabel('Facility scope')).toBeVisible();
      const overviewSection = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Facilities Overview' }) });
      await expect(overviewSection.getByRole('row', { name: seeded.facilityAName })).toBeVisible();
      await expect(overviewSection.getByRole('row', { name: seeded.facilityBName })).toBeVisible();

      // Drill into facility A: the row itself is the navigation affordance.
      await overviewSection.getByRole('row', { name: seeded.facilityAName }).click();
      await page.waitForURL(`**/dashboard?facility=${seeded.facilityAId}`);

      await expect(page.getByText('Here is an overview of your facility')).toBeVisible();
      // Breadcrumb shows the scoped facility's name (the switcher's <select>
      // value also renders that name, so scope past it with .first()).
      await expect(page.getByText(seeded.facilityAName).first()).toBeVisible();

      // The switcher on the scoped view is set to facility A.
      const switcher = page.getByLabel('Facility scope');
      await expect(switcher).toContainText(seeded.facilityAName);

      // Clearing the selection in the scope palette returns to the Global View.
      // The "All facilities" chip applies immediately and closes the palette
      // (FacilityScopePalette.tsx's applyAllFacilities) — there is no separate
      // confirmation step once it's clicked.
      await switcher.click();
      await page.getByRole('button', { name: 'All facilities' }).click();
      await page.waitForURL('**/dashboard');
      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('a tampered ?facility= id (foreign/nonexistent) falls back to the Global View, not an error', async ({
    page,
  }) => {
    const seeded = await seedOrgWithTwoFacilities();
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      await page.goto(`/dashboard?facility=${crypto.randomUUID()}`);
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
      await expect(page.getByText(/error|forbidden|not found/i)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Facility dashboard: founder tiles over the organisation, by current roster', () => {
  /** The value `<p>` immediately following a card's label `<p>`. */
  function cardValue(page: Page, label: string) {
    return page.getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
  }

  function facilitiesOverview(page: Page) {
    return page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Facilities Overview' }) });
  }

  test('reports Total Active Courses, Total Assigned Learners and the highest-score Average Grade, and counts a transferred member at their current facility only', async ({
    page,
  }) => {
    const seeded = await seedOrgWithOneFacilityAndKnownData();
    let transfer: SeededTransfer | null = null;
    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);

      // One facility: the classic dashboard, never the multi-site Global View.
      await expect(
        page.getByText('Here is an overview across all your facilities'),
      ).not.toBeVisible();

      // The owner did not author the course — HR did — and it still counts.
      await expect(cardValue(page, 'Total Active Courses')).toHaveText('1');
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');
      // 60 then 88: the highest submitted score wins.
      await expect(cardValue(page, 'Average Grade')).toHaveText(`${seeded.bestScore}%`);
      await expect(page.getByText('Total Courses', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Total Staff Assigned', { exact: true })).toHaveCount(0);

      // A second facility and a member who moved to it. Their enrolment is
      // stamped with facility A; their roster says B.
      transfer = await addSecondFacilityWithTransferredMember(seeded);

      await page.goto('/dashboard');
      await expect(page.getByText('Here is an overview across all your facilities')).toBeVisible();
      // Worker + moved member; the owner and HR hold no training.
      await expect(cardValue(page, 'Total Staff Count')).toHaveText('2');
      // "Active Learners" also heads a Priority Risks column — scope to its tile.
      const velocity = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Training Velocity' }) });
      await expect(
        velocity
          .getByText('Active Learners', { exact: true })
          .locator('xpath=following-sibling::p[1]'),
      ).toHaveText('2');

      // Facility A: unchanged — the moved member's stamped enrolment is not here.
      await facilitiesOverview(page).getByRole('row', { name: seeded.facilityAName }).click();
      await page.waitForURL(`**/dashboard?facility=${seeded.facilityAId}`);
      await expect(cardValue(page, 'Total Active Courses')).toHaveText('1');
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');
      await expect(cardValue(page, 'Average Grade')).toHaveText(`${seeded.bestScore}%`);

      // Facility B: the moved member counts here, where they work now.
      await page.goto('/dashboard');
      await facilitiesOverview(page).getByRole('row', { name: transfer.facilityBName }).click();
      await page.waitForURL(`**/dashboard?facility=${transfer.facilityBId}`);
      await expect(cardValue(page, 'Total Active Courses')).toHaveText('1');
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');
      await expect(cardValue(page, 'Average Grade')).toHaveText('0%');
    } finally {
      await cleanupSingleFacility(seeded, transfer);
    }
  });

  // TOOL-19: the owner test above cannot catch a Finance-only predicate drift
  // (BUG-01) — the owner's predicate never changed. Finance reaches this page on
  // `billing.read`, so it must see the owner's figures and nothing roster-level.
  test('Finance sees the same tiles as the Owner for the same scope, no Courses table or Status Tracker, and the Global View once there are 2 facilities', async ({
    browser,
  }) => {
    const seeded = await seedOrgWithOneFacilityAndKnownData();
    const finance = await addFinanceMember(seeded);
    let transfer: SeededTransfer | null = null;
    const ownerContext = await browser.newContext();
    const financeContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      const financePage = await financeContext.newPage();
      await login(ownerPage, seeded.ownerEmail, seeded.ownerPassword);
      await login(financePage, finance.email, FINANCE_PASSWORD);

      const tiles = ['Total Active Courses', 'Total Assigned Learners', 'Average Grade'];
      const expected = ['1', '1', `${seeded.bestScore}%`];

      async function expectSameTiles() {
        for (const [index, label] of tiles.entries()) {
          await expect(cardValue(ownerPage, label)).toHaveText(expected[index]);
          await expect(cardValue(financePage, label)).toHaveText(expected[index]);
        }
      }

      // One facility: the classic dashboard for both.
      await expectSameTiles();

      // The owner sees both roster-level sections, so their absence for
      // Finance below is the gate and not an empty page.
      await expect(ownerPage.getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
      await expect(
        ownerPage.getByRole('heading', { name: 'Status Tracker', exact: true }),
      ).toBeVisible();
      await expect(financePage.getByRole('heading', { name: 'Courses', exact: true })).toHaveCount(
        0,
      );
      await expect(
        financePage.getByRole('heading', { name: 'Status Tracker', exact: true }),
      ).toHaveCount(0);

      // A second facility: Finance oversees the organisation, so it lands on
      // the Global View like the owner.
      transfer = await addSecondFacilityWithTransferredMember(seeded);
      await financePage.goto('/dashboard');
      await expect(
        financePage.getByText('Here is an overview across all your facilities'),
      ).toBeVisible();
      await expect(cardValue(financePage, 'Total Number of Facilities')).toHaveText('2');

      // Same scope, same tiles: Facility A for both.
      await ownerPage.goto(`/dashboard?facility=${seeded.facilityAId}`);
      await financePage.goto(`/dashboard?facility=${seeded.facilityAId}`);
      await expect(financePage.getByText('Here is an overview of your facility')).toBeVisible();
      await expectSameTiles();
      await expect(financePage.getByRole('heading', { name: 'Courses', exact: true })).toHaveCount(
        0,
      );
      await expect(
        financePage.getByRole('heading', { name: 'Status Tracker', exact: true }),
      ).toHaveCount(0);
    } finally {
      await ownerContext.close();
      await financeContext.close();
      await removeMember(finance);
      await cleanupSingleFacility(seeded, transfer);
    }
  });
});
