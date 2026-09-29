/**
 * E2E spec: switching the dashboard's facility scope (TOOL-10).
 *
 * Acceptance criteria:
 *   - An owner of a two-facility organisation starts on the Global View
 *     ("All Facilities", no `?facility=`), and the FacilityScopeSwitcher moves
 *     them to Facility 1, then Facility 2, then a comparison of both. Each step
 *     rewrites `?facility=` and renders that mode's heading, subtitle, switcher
 *     label and tile values.
 *   - A supervisor bound to one facility gets no switcher, and a `?facility=`
 *     naming the facility they are NOT bound to is dropped: they keep seeing
 *     their own facility's data and never the other facility's name or counts.
 *
 * Seeded data (the tiles make each scope distinguishable):
 *   Facility 1 — one worker with an unfinished enrolment  → 1 assigned learner
 *   Facility 2 — two workers with unfinished enrolments   → 2 assigned learners
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

const PASSWORD = 'FacScope!Pass9';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@facility-scope-e2e.invalid`;
}

interface Seeded {
  orgId: string;
  facility1Id: string;
  facility1Name: string;
  facility2Id: string;
  facility2Name: string;
  courseId: string;
  ownerEmail: string;
  supervisorEmail: string;
  userIds: string[];
  orgUserIds: string[];
}

async function seed(): Promise<Seeded> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    const slug = `facility-scope-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facility1Id = crypto.randomUUID();
    const facility2Id = crypto.randomUUID();
    // "Alpha" sorts before "Beta": the switcher lists facilities by name.
    const facility1Name = `Alpha Site ${slug}`;
    const facility2Name = `Beta Site ${slug}`;
    const courseId = crypto.randomUUID();
    const ownerEmail = uid('owner');
    const supervisorEmail = uid('supervisor');
    const userIds: string[] = [];
    const orgUserIds: string[] = [];

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Facility Scope E2E ${slug}`, slug, ownerEmail],
    );
    for (const [id, name] of [
      [facility1Id, facility1Name],
      [facility2Id, facility2Name],
    ]) {
      await client.query(
        `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
         VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
        [id, orgId, name],
      );
    }

    async function member(email: string, role: string, facilityId: string, name: string) {
      const userId = crypto.randomUUID();
      const orgUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, 'Scope', $5, NOW(), NOW())`,
        [userId, email, hashed, name, `${name} Scope`],
      );
      await client.query(
        `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
        [orgUserId, userId, orgId, role],
      );
      await client.query(
        `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [crypto.randomUUID(), orgUserId, facilityId],
      );
      userIds.push(userId);
      orgUserIds.push(orgUserId);
      return orgUserId;
    }

    const ownerOrgUserId = await member(ownerEmail, 'owner', facility1Id, 'Owner');
    await member(supervisorEmail, 'supervisor', facility1Id, 'Supervisor');
    const worker1 = await member(uid('worker1'), 'nurse', facility1Id, 'WorkerOne');
    const worker2 = await member(uid('worker2'), 'nurse', facility2Id, 'WorkerTwo');
    const worker3 = await member(uid('worker3'), 'nurse', facility2Id, 'WorkerThree');

    await client.query(
      `INSERT INTO courses (
         id, title, status, created_by_org_user_id, organization_id,
         type, is_global, review_required, created_at, updated_at
       ) VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, false, NOW(), NOW())`,
      [courseId, `Scope Course ${slug}`, ownerOrgUserId, orgId],
    );
    for (const [orgUserId, facilityId] of [
      [worker1, facility1Id],
      [worker2, facility2Id],
      [worker3, facility2Id],
    ]) {
      await client.query(
        `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, started_at)
         VALUES ($1, $2, $3, $4, 'in_progress'::"EnrollmentStatus", 50, NOW() - interval '1 day')`,
        [crypto.randomUUID(), orgUserId, courseId, facilityId],
      );
    }

    return {
      orgId,
      facility1Id,
      facility1Name,
      facility2Id,
      facility2Name,
      courseId,
      ownerEmail,
      supervisorEmail,
      userIds,
      orgUserIds,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM enrollments WHERE course_id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [seeded.orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [seeded.orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [seeded.userIds]);
    await client.query(`DELETE FROM facilities WHERE id = ANY($1)`, [
      [seeded.facility1Id, seeded.facility2Id],
    ]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  // Pre-dismiss the "create your first course" empty-state modal — its overlay
  // would otherwise intercept clicks on the dashboard content.
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

/** The value `<p>` immediately following a card's label `<p>`. */
function cardValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
}

/** The ids in the current URL's `?facility=` param, sorted; [] when absent. */
function facilityParamIds(page: Page): string[] {
  const value = new URL(page.url()).searchParams.get('facility');
  return value ? value.split(',').sort() : [];
}

const GLOBAL_SUBTITLE = 'Here is an overview across all your facilities';
const FACILITY_SUBTITLE = 'Here is an overview of your facility';

test.describe('Dashboard facility scope switching', () => {
  test('owner switches All → Facility 1 → Facility 2 → compare both, and each scope rewrites ?facility= and its view', async ({
    page,
  }) => {
    const seeded = await seed();
    try {
      await login(page, seeded.ownerEmail);
      const switcher = page.getByRole('button', { name: /^Facility scope:/ });
      const palette = page.getByRole('dialog');

      // ── All facilities: the Global View, no param ───────────────────────────
      expect(facilityParamIds(page)).toEqual([]);
      await expect(page.getByRole('heading', { level: 1, name: /^Welcome back/ })).toBeVisible();
      await expect(page.getByText(GLOBAL_SUBTITLE)).toBeVisible();
      await expect(switcher).toHaveAccessibleName('Facility scope: All Facilities');
      await expect(cardValue(page, 'Total Number of Facilities')).toHaveText('2');
      await expect(cardValue(page, 'Total Staff Count')).toHaveText('3');

      // ── Facility 1 ──────────────────────────────────────────────────────────
      await switcher.click();
      await palette.getByRole('button', { name: seeded.facility1Name, exact: true }).click();
      await palette.getByRole('button', { name: 'Select 1 facility' }).click();
      await page.waitForURL(`**/dashboard?facility=${seeded.facility1Id}`);

      expect(facilityParamIds(page)).toEqual([seeded.facility1Id]);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
      ).toBeVisible();
      await expect(page.getByText(FACILITY_SUBTITLE)).toBeVisible();
      await expect(page.getByText(GLOBAL_SUBTITLE)).not.toBeVisible();
      await expect(switcher).toHaveAccessibleName(`Facility scope: ${seeded.facility1Name}`);
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');

      // ── Facility 2: the palette opens on Facility 1, so swap the selection ──
      await switcher.click();
      await expect(
        palette.getByRole('button', { name: seeded.facility1Name, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await palette.getByRole('button', { name: seeded.facility1Name, exact: true }).click();
      await palette.getByRole('button', { name: seeded.facility2Name, exact: true }).click();
      await palette.getByRole('button', { name: 'Select 1 facility' }).click();
      await page.waitForURL(`**/dashboard?facility=${seeded.facility2Id}`);

      expect(facilityParamIds(page)).toEqual([seeded.facility2Id]);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
      ).toBeVisible();
      await expect(page.getByText(FACILITY_SUBTITLE)).toBeVisible();
      await expect(switcher).toHaveAccessibleName(`Facility scope: ${seeded.facility2Name}`);
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('2');

      // ── Compare both: back to the Global View, narrowed to the selection ───
      await switcher.click();
      await palette.getByRole('button', { name: seeded.facility1Name, exact: true }).click();
      await palette.getByRole('button', { name: 'Select 2 facilities' }).click();
      await page.waitForURL(/\/dashboard\?facility=[^&]+,[^&]+$/);

      expect(facilityParamIds(page)).toEqual([seeded.facility1Id, seeded.facility2Id].sort());
      await expect(page.getByRole('heading', { level: 1, name: /^Welcome back/ })).toBeVisible();
      await expect(page.getByText(GLOBAL_SUBTITLE)).toBeVisible();
      await expect(switcher).toHaveAccessibleName('Facility scope: 2 facilities selected');
      await expect(cardValue(page, 'Total Number of Facilities')).toHaveText('2');
      await expect(cardValue(page, 'Total Staff Count')).toHaveText('3');

      // ── And back to All via the palette's chip ─────────────────────────────
      await switcher.click();
      await palette.getByRole('button', { name: 'All facilities' }).click();
      await page.waitForURL('**/dashboard');
      expect(facilityParamIds(page)).toEqual([]);
      await expect(switcher).toHaveAccessibleName('Facility scope: All Facilities');
    } finally {
      await cleanup(seeded);
    }
  });

  test('a supervisor bound to Facility 1 has no switcher and cannot select Facility 2 through ?facility=', async ({
    page,
  }) => {
    const seeded = await seed();
    try {
      await login(page, seeded.supervisorEmail);

      // One accessible facility: no switcher, and only Facility 1's data.
      await expect(
        page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Facility scope:/ })).toHaveCount(0);
      await expect(page.getByText(GLOBAL_SUBTITLE)).not.toBeVisible();
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');

      // Facility 2 alone: the id is outside their access, so it is dropped —
      // the view stays on their own facility and never names Facility 2.
      await page.goto(`/dashboard?facility=${seeded.facility2Id}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
      ).toBeVisible();
      await expect(page.getByText(seeded.facility2Name)).toHaveCount(0);
      await expect(page.getByText(FACILITY_SUBTITLE)).not.toBeVisible();
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');

      // A comparison naming both: Facility 2 is dropped, leaving a drill-down
      // into Facility 1 — never a Global View spanning both.
      await page.goto(`/dashboard?facility=${seeded.facility1Id},${seeded.facility2Id}`);
      await expect(page.getByText(FACILITY_SUBTITLE)).toBeVisible();
      await expect(page.getByText(GLOBAL_SUBTITLE)).not.toBeVisible();
      // The breadcrumb names the facility in scope.
      await expect(page.getByText(seeded.facility1Name).first()).toBeVisible();
      await expect(page.getByText(seeded.facility2Name)).toHaveCount(0);
      await expect(cardValue(page, 'Total Assigned Learners')).toHaveText('1');
    } finally {
      await cleanup(seeded);
    }
  });
});
