/**
 * E2E spec: multi-course staff assignment collapses N courses into ONE email
 * and ONE in-app notification (feature/multi-course-assign-batched-email).
 *
 * Root-cause bug this replaces: assigning several courses to one staff member
 * either sent one launch email PER course (naming only that course) or, on the
 * staging multi-select path, sent nothing at all. This spec drives the real
 * staff-profile "Assign Course" flow (`AssignCoursesModal`, opened from
 * `StaffProfileClient`) end to end and asserts the collapse directly against
 * the `email_messages` / `notifications` / `enrollments` / `reminder_logs`
 * tables — there is no MailHog HTTP helper in this repo, so `sendMailTracked`'s
 * `email_messages` row (kind = 'course_launch') is the email assertion.
 *
 * Deliberate deviation from a literal "reopen and select the pre-enrolled
 * course" reading of the zero-newly-assigned scenario: `AssignCoursesModal`
 * intentionally renders an already-enrolled course's checkbox DISABLED with an
 * "Assigned" badge (see the component's own docstring), so a course that was
 * already-enrolled BEFORE the page loaded can never be selected through the
 * UI — that disabled state is itself the product's primary defense. To still
 * exercise the server's "0 newly assigned ⇒ no email" branch through a real
 * browser round-trip (not just the unit/RTL suites), this spec reopens the
 * modal WITHOUT an intervening page reload right after Scenario 1: the
 * `enrolledCourseIds` prop `AssignCoursesModal` receives is computed once at
 * the server-rendered page load and does not refresh itself without a
 * navigation, so courses 1-3 (just enrolled by Scenario 1) still render
 * selectable — letting the admin re-select one and hit the server's genuine
 * already-enrolled/zero-assigned path, exactly as a slow-reacting client would.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005 (Playwright webServer).
 *   - DATABASE_URL reachable for direct DB seeding/mutation.
 *
 * Seeding note: role, organization and facility live on the
 * `organization_users` membership row, not on `users` — a `users` row is
 * credentials plus display name. Every domain table here (enrollments,
 * notifications, courses.created_by_org_user_id) and the
 * /dashboard/staff/[id] route itself address the membership id, so the seed
 * creates both and the assertions use `workerOrgUserId`.
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
  /** `users` row. Authentication only — never a foreign key on domain tables. */
  ownerUserId: string;
  /** `organization_users` row: the id every domain table and route addresses. */
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  workerUserId: string;
  workerOrgUserId: string;
  workerEmail: string;
  courseA: string; // video — Scenario 1 batch
  courseB: string; // video — Scenario 1 batch
  courseC: string; // video — Scenario 1 batch
  coursePreEnrolled: string; // text — pre-existing enrollment before the test starts
  courseSingle: string; // video — Scenario 3 (single-course, same path)
  coursePreserve: string; // text — Scenario 4 (preserve mode); has a pre-existing CourseAssignment
  preserveAssignmentId: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@mc-assign-e2e.invalid`;
}

async function seed(): Promise<Seeded> {
  const client = await db();
  try {
    const ownerEmail = uid('owner');
    const ownerPassword = 'McAssign!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const workerEmail = uid('worker');
    const workerHashed = await bcrypt.hash('McAssign!Worker9', 10);
    const slug = `mc-assign-${crypto.randomBytes(4).toString('hex')}`;

    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const workerUserId = crypto.randomUUID();
    const workerOrgUserId = crypto.randomUUID();
    const courseA = crypto.randomUUID();
    const courseB = crypto.randomUUID();
    const courseC = crypto.randomUUID();
    const coursePreEnrolled = crypto.randomUUID();
    const courseSingle = crypto.randomUUID();
    const coursePreserve = crypto.randomUUID();
    const preserveAssignmentId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `MC Assign E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `MC Assign E2E Facility ${slug}`],
    );

    // Membership, not the user row, carries role/org/facility: a `users` row is
    // only credentials + display name, and every domain table keys off the
    // `organization_users` id.
    for (const person of [
      {
        userId: ownerUserId,
        orgUserId: ownerOrgUserId,
        email: ownerEmail,
        hashed: ownerHashed,
        role: 'owner',
        first: 'MC',
        last: 'Owner',
        jobTitle: null,
      },
      {
        userId: workerUserId,
        orgUserId: workerOrgUserId,
        email: workerEmail,
        hashed: workerHashed,
        role: 'nurse',
        first: 'MC',
        last: 'Worker',
        jobTitle: 'Staff Nurse',
      },
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
        [
          person.userId,
          person.email,
          person.hashed,
          person.first,
          person.last,
          `${person.first} ${person.last}`,
        ],
      );
      await client.query(
        `INSERT INTO organization_users (id, user_id, organization_id, role, job_title, active, joined_at, role_assigned_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::"UserRole", $5, true, NOW(), NOW(), NOW(), NOW())`,
        [person.orgUserId, person.userId, orgId, person.role, person.jobTitle],
      );
      await client.query(
        `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [crypto.randomUUID(), person.orgUserId, facilityId],
      );
    }

    // Active subscription: enrollUsers' billing gate requires it.
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

    const courses: [string, string, 'video' | 'text'][] = [
      [courseA, `MC Assign Course A ${slug}`, 'video'],
      [courseB, `MC Assign Course B ${slug}`, 'video'],
      [courseC, `MC Assign Course C ${slug}`, 'video'],
      [coursePreEnrolled, `MC Assign Course PreEnrolled ${slug}`, 'text'],
      [courseSingle, `MC Assign Course Single ${slug}`, 'video'],
      [coursePreserve, `MC Assign Course Preserve ${slug}`, 'text'],
    ];
    for (const [id, title, type] of courses) {
      await client.query(
        `INSERT INTO courses (id, title, status, created_by_org_user_id, organization_id, type, is_global, created_at, updated_at)
         VALUES ($1, $2, 'published'::"CourseStatus", $3, $4, $5::"CourseType", false, NOW(), NOW())`,
        [id, title, ownerOrgUserId, orgId, type],
      );
    }

    // Pre-existing enrollment on coursePreEnrolled — the worker is already
    // assigned to it before the test ever opens the modal.
    const preEnrolledEnrollmentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, started_at)
       VALUES ($1, $2, $3, $4, 'enrolled'::"EnrollmentStatus", NOW())`,
      [preEnrolledEnrollmentId, workerOrgUserId, coursePreEnrolled, facilityId],
    );

    // Pre-existing CourseAssignment (with distinctive settings) for
    // coursePreserve — Scenario 4 asserts these survive a `preserve`-mode
    // assign untouched, while the worker's own enrollment gets the new
    // deadline chosen in the UI.
    await client.query(
      `INSERT INTO course_assignments (
         id, organization_id, course_id, assigned_by_admin_id, schedule_at, due_at,
         due_window_days, reminders_enabled, renewal_cycle, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, NULL, $5, NULL, false, 'annual'::"RenewalCycle", NOW(), NOW())`,
      [
        preserveAssignmentId,
        orgId,
        coursePreserve,
        ownerOrgUserId,
        new Date('2099-01-01T00:00:00Z'), // sentinel — must be untouched by the assign
      ],
    );
    await client.query(
      `INSERT INTO assignment_reminder_stages (id, assignment_id, stage, offset_days, enabled, channels)
       VALUES ($1, $2, 'FRIENDLY_REMINDER'::"ReminderStage", -21, true, ARRAY['email'])`,
      [crypto.randomUUID(), preserveAssignmentId],
    );

    return {
      orgId,
      facilityId,
      ownerUserId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      workerUserId,
      workerOrgUserId,
      workerEmail,
      courseA,
      courseB,
      courseC,
      coursePreEnrolled,
      courseSingle,
      coursePreserve,
      preserveAssignmentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanup(s: Seeded): Promise<void> {
  const client = await db();
  try {
    const courseIds = [
      s.courseA,
      s.courseB,
      s.courseC,
      s.coursePreEnrolled,
      s.courseSingle,
      s.coursePreserve,
    ];
    await client.query(
      `DELETE FROM reminder_logs WHERE enrollment_id IN (
         SELECT id FROM enrollments WHERE course_id = ANY($1)
       )`,
      [courseIds],
    );
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      [s.ownerOrgUserId, s.workerOrgUserId],
    ]);
    await client.query(`DELETE FROM email_messages WHERE to_email = $1`, [s.workerEmail]);
    await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1)`, [courseIds]);
    await client.query(
      `DELETE FROM assignment_reminder_stages WHERE assignment_id IN (
         SELECT id FROM course_assignments WHERE course_id = ANY($1)
       )`,
      [courseIds],
    );
    await client.query(`DELETE FROM course_assignments WHERE course_id = ANY($1)`, [courseIds]);
    await client.query(`DELETE FROM org_course_offerings WHERE course_id = ANY($1)`, [courseIds]);
    await client.query(`DELETE FROM courses WHERE id = ANY($1)`, [courseIds]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [[s.ownerOrgUserId, s.workerOrgUserId]],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [
      [s.ownerOrgUserId, s.workerOrgUserId],
    ]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [[s.ownerUserId, s.workerUserId]]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [s.orgId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [s.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [s.orgId]);
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

/**
 * `created_at` columns are `timestamp without time zone`, populated from the
 * DB server's own (UTC) clock. Binding a raw JS `Date` here would have `pg`
 * serialize it using the Node process's LOCAL wall-clock components — wrong
 * whenever the host timezone isn't UTC (it silently skews every `since`
 * comparison by the host's UTC offset). Passing an explicit `.toISOString()`
 * string sidesteps that: Postgres parses it as literal UTC wall-clock digits.
 */
function sinceParam(since: Date): string {
  return since.toISOString();
}

async function emailCount(workerEmail: string, since: Date): Promise<number> {
  const client = await db();
  try {
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM email_messages
       WHERE to_email = $1 AND kind = 'course_launch' AND created_at >= $2`,
      [workerEmail, sinceParam(since)],
    );
    return res.rows[0].n;
  } finally {
    await client.end();
  }
}

async function latestNotification(
  workerOrgUserId: string,
  since: Date,
): Promise<{ message: string; metadata: Record<string, unknown> } | null> {
  const client = await db();
  try {
    const res = await client.query(
      `SELECT message, metadata FROM notifications
       WHERE organization_user_id = $1 AND type = 'COURSE_ASSIGNED' AND created_at >= $2
       ORDER BY created_at DESC LIMIT 1`,
      [workerOrgUserId, sinceParam(since)],
    );
    return res.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function notificationCount(workerOrgUserId: string, since: Date): Promise<number> {
  const client = await db();
  try {
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM notifications
       WHERE organization_user_id = $1 AND type = 'COURSE_ASSIGNED' AND created_at >= $2`,
      [workerOrgUserId, sinceParam(since)],
    );
    return res.rows[0].n;
  } finally {
    await client.end();
  }
}

test.describe('Staff profile — assign multiple courses in one action', () => {
  test('N courses collapse into one email/notification, zero-newly-assigned sends nothing, single-course keeps the same path, and preserve mode leaves the shared assignment untouched', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const seeded = await seed();
    const t0 = new Date();

    try {
      await login(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto(`/dashboard/staff/${seeded.workerOrgUserId}`);
      await page.waitForLoadState('networkidle');

      // A second tab in the SAME authenticated session (same BrowserContext,
      // so it shares cookies — no second login needed), opened and loaded
      // BEFORE Scenario 1 assigns anything. Its `enrolledCourseIds` server
      // prop is captured at this pre-assignment moment and — unlike `page`,
      // whose Server Action calls auto-revalidate this route's Server
      // Components live — never refreshes without an explicit navigation.
      // Scenario 2 reuses it to model two admins racing: one submits the
      // assignment, the other's already-open tab still shows the course as
      // selectable and submits the exact same course afterward.
      const stalePage = await page.context().newPage();
      await stalePage.goto(`/dashboard/staff/${seeded.workerOrgUserId}`);
      await stalePage.waitForLoadState('networkidle');

      // ── Scenario 1: 3 courses ⇒ exactly ONE email, ONE notification ────────
      await page.getByRole('button', { name: 'Assign Course', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Assign Courses')).toBeVisible();

      await dialog.getByRole('checkbox', { name: `MC Assign Course A`, exact: false }).click();
      await dialog.getByRole('checkbox', { name: `MC Assign Course B`, exact: false }).click();
      await dialog.getByRole('checkbox', { name: `MC Assign Course C`, exact: false }).click();
      await dialog.getByRole('button', { name: 'Assign 3 courses' }).click();

      await expect(dialog.getByText('Set Completion Deadline')).toBeVisible();
      await dialog.getByRole('button', { name: '30 days' }).click();
      await dialog.getByRole('button', { name: 'Assign 3 courses' }).click();

      await expect(dialog.getByText('Courses Assigned Successfully')).toBeVisible({
        timeout: 20000,
      });

      await expect.poll(() => emailCount(seeded.workerEmail, t0), { timeout: 15000 }).toBe(1);
      await expect
        .poll(() => notificationCount(seeded.workerOrgUserId, t0), { timeout: 15000 })
        .toBe(1);
      const batchNotification = await latestNotification(seeded.workerOrgUserId, t0);
      expect(batchNotification).not.toBeNull();
      expect(batchNotification!.metadata.courseIds).toHaveLength(3);
      expect(batchNotification!.metadata.count).toBe(3);

      const dbAfterBatch = await db();
      try {
        const enrollmentRes = await dbAfterBatch.query(
          `SELECT id, course_id, due_at FROM enrollments
           WHERE organization_user_id = $1 AND course_id = ANY($2)`,
          [seeded.workerOrgUserId, [seeded.courseA, seeded.courseB, seeded.courseC]],
        );
        expect(enrollmentRes.rows).toHaveLength(3);
        for (const row of enrollmentRes.rows) {
          expect(row.due_at).not.toBeNull();
        }

        // Catches an implementation that batches away the per-enrollment
        // INITIAL_LAUNCH ladder seed — must be one row per enrollment, not one
        // per email.
        const launchLogRes = await dbAfterBatch.query(
          `SELECT COUNT(*)::int AS n FROM reminder_logs
           WHERE stage = 'INITIAL_LAUNCH'
             AND enrollment_id = ANY($1)`,
          [enrollmentRes.rows.map((r) => r.id)],
        );
        expect(launchLogRes.rows[0].n).toBe(3);
      } finally {
        await dbAfterBatch.end();
      }

      // ── Scenario 2: zero newly assigned ⇒ no additional email/notification ─
      // `stalePage` never navigated since before Scenario 1 ran, so course A's
      // checkbox still renders selectable there even though it is now truly
      // enrolled. Selecting and submitting it reproduces the server's genuine
      // already-enrolled / zero-newly-assigned branch through a real request.
      const t1 = new Date();
      await stalePage.getByRole('button', { name: 'Assign Course', exact: true }).click();
      const staleDialog = stalePage.getByRole('dialog');
      await expect(staleDialog.getByText('Assign Courses')).toBeVisible();
      await staleDialog.getByRole('checkbox', { name: `MC Assign Course A`, exact: false }).click();
      await staleDialog.getByRole('button', { name: 'Assign Course' }).click();
      await expect(staleDialog.getByText('Set Completion Deadline')).toBeVisible();
      await staleDialog.getByRole('button', { name: 'Assign Course' }).click();

      // The modal reports the refusal as an error on the deadline step and
      // never advances to the success step — `assigned.length === 0` is the
      // branch under test, whatever wording it carries.
      await expect(staleDialog.getByText(/already assigned to the selected course/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(staleDialog.getByText('Courses Assigned Successfully')).not.toBeVisible();

      await expect.poll(() => emailCount(seeded.workerEmail, t1), { timeout: 10000 }).toBe(0);
      expect(await notificationCount(seeded.workerOrgUserId, t1)).toBe(0);

      await stalePage.close();

      // ── Scenario 3: single course through the same path ────────────────────
      // Reload for honest `enrolledCourseIds` before picking a genuinely fresh
      // course.
      await page.reload();
      await page.waitForLoadState('networkidle');
      const t2 = new Date();

      await page.getByRole('button', { name: 'Assign Course', exact: true }).click();
      await expect(dialog.getByText('Assign Courses')).toBeVisible();
      await dialog.getByRole('checkbox', { name: `MC Assign Course Single`, exact: false }).click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();
      await expect(dialog.getByText('Set Completion Deadline')).toBeVisible();
      await dialog.getByRole('button', { name: '6 months' }).click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();

      await expect(dialog.getByText('Courses Assigned Successfully')).toBeVisible({
        timeout: 20000,
      });

      await expect.poll(() => emailCount(seeded.workerEmail, t2), { timeout: 15000 }).toBe(1);
      const singleNotification = await latestNotification(seeded.workerOrgUserId, t2);
      expect(singleNotification).not.toBeNull();
      expect(singleNotification!.metadata.count).toBe(1);

      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // ── Scenario 4: preserve mode — shared CourseAssignment stays untouched ─
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Assign Course', exact: true }).click();
      await expect(dialog.getByText('Assign Courses')).toBeVisible();
      await dialog.getByRole('tab', { name: /reading courses/i }).click();
      await dialog
        .getByRole('checkbox', { name: `MC Assign Course Preserve`, exact: false })
        .click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();
      await expect(dialog.getByText('Set Completion Deadline')).toBeVisible();
      await dialog.getByRole('button', { name: '1 year' }).click();
      await dialog.getByRole('button', { name: 'Assign Course' }).click();

      await expect(dialog.getByText('Courses Assigned Successfully')).toBeVisible({
        timeout: 20000,
      });

      const dbAfterPreserve = await db();
      try {
        const assignmentRes = await dbAfterPreserve.query(
          `SELECT reminders_enabled, renewal_cycle, due_at FROM course_assignments WHERE id = $1`,
          [seeded.preserveAssignmentId],
        );
        expect(assignmentRes.rows).toHaveLength(1);
        expect(assignmentRes.rows[0].reminders_enabled).toBe(false);
        expect(assignmentRes.rows[0].renewal_cycle).toBe('annual');
        expect(new Date(assignmentRes.rows[0].due_at).toISOString()).toBe(
          '2099-01-01T00:00:00.000Z',
        );

        const stageRes = await dbAfterPreserve.query(
          `SELECT stage, offset_days FROM assignment_reminder_stages WHERE assignment_id = $1`,
          [seeded.preserveAssignmentId],
        );
        expect(stageRes.rows).toHaveLength(1);
        expect(stageRes.rows[0].stage).toBe('FRIENDLY_REMINDER');
        expect(stageRes.rows[0].offset_days).toBe(-21);

        // The worker's own enrollment still gets the deadline chosen in the UI —
        // preserve mode only shields the SHARED org-wide assignment settings.
        const enrollmentRes = await dbAfterPreserve.query(
          `SELECT due_at FROM enrollments WHERE organization_user_id = $1 AND course_id = $2`,
          [seeded.workerOrgUserId, seeded.coursePreserve],
        );
        expect(enrollmentRes.rows).toHaveLength(1);
        expect(enrollmentRes.rows[0].due_at).not.toBeNull();
        expect(new Date(enrollmentRes.rows[0].due_at).getFullYear()).toBeGreaterThanOrEqual(
          new Date().getFullYear() + 1,
        );
      } finally {
        await dbAfterPreserve.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
