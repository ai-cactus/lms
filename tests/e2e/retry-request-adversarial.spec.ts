/**
 * E2E spec: adversarial probes of the Q-35 retry request and its admin grant
 * (SEC-18, SEC-19), driven at the Server Action endpoint rather than the UI.
 *
 * The UI only ever offers the legitimate id, so these tests capture the real
 * Next-Action id from a genuine click (aborting that request so nothing is
 * written), then replay the action by hand with hostile arguments, using the
 * signed-in browser context's own cookies.
 *
 *   SEC-18  requestCourseRetry on a completed / in-progress enrolment, and on
 *           another learner's (same org or other org) locked one: refused, no
 *           DB change.
 *   SEC-19  assignRetake with another org's locked enrolment (not-found shape),
 *           and, as a facility-bound supervisor, a learner outside their
 *           facilities: refused, no retake row created.
 *   Deep link  `?retake=` naming another learner's or another org's
 *           enrolment never opens the dialog nor leaks that enrolment's course.
 *   Cool-down  two simultaneous requests produce exactly one notice per
 *           admin; a repeat inside 72h is silent, one after 72h notifies again.
 *
 * Self-provisioned (two throwaway orgs) and removed afterwards.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';
const PASSWORD = 'RetryAdversarial!9';

const NOT_FOUND_MESSAGE = 'That training record could not be found in your organization.';
const OUTSIDE_FACILITY_MESSAGE = 'That staff member is outside the facilities you manage.';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

function email(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@retry-adversarial-e2e.invalid`;
}

interface Member {
  userId: string;
  orgUserId: string;
  email: string;
}

interface Fixture {
  orgIds: string[];
  userIds: string[];
  orgUserIds: string[];
  courseIds: string[];
  facilityIds: string[];
  ownerA: Member;
  supervisorA1: Member;
  learnerA1: Member;
  learnerA2: Member;
  learnerB: Member;
  // learnerA1's enrolments
  lockedA1: string;
  completedA1: string;
  inProgressA1: string;
  // other learners' locked enrolments
  lockedA2: string;
  lockedB: string;
  titles: { a2: string; b: string };
}

let fx: Fixture;

async function seedFixture(): Promise<Fixture> {
  const client = await db();
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const orgIds: string[] = [];
  const facilityIds: string[] = [];
  const userIds: string[] = [];
  const orgUserIds: string[] = [];
  const courseIds: string[] = [];
  try {
    const tag = crypto.randomBytes(4).toString('hex');

    const seedOrg = async (label: string) => {
      const orgId = crypto.randomUUID();
      await client.query(
        `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
        [orgId, `Retry Adversarial ${label} ${tag}`, `retry-adv-${label}-${tag}`, email('org')],
      );
      const periodEnd = new Date();
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      await client.query(
        `INSERT INTO subscriptions (
           id, organization_id, stripe_subscription_id, stripe_price_id, plan,
           billing_cycle, status, current_period_start, current_period_end,
           cancel_at_period_end, paused_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
           'active'::"SubscriptionStatus", NOW(), $5, false, NULL, NOW(), NOW())`,
        [
          crypto.randomUUID(),
          orgId,
          `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
          `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
          periodEnd,
        ],
      );
      orgIds.push(orgId);
      return orgId;
    };

    const seedFacility = async (orgId: string, name: string) => {
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
         VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
        [id, orgId, `${name} ${tag}`],
      );
      facilityIds.push(id);
      return id;
    };

    const seedMember = async (
      orgId: string,
      facilityId: string,
      role: string,
      first: string,
    ): Promise<Member> => {
      const userId = crypto.randomUUID();
      const orgUserId = crypto.randomUUID();
      const addr = email(first.toLowerCase());
      await client.query(
        `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'credentials', $4, 'Adversarial', $5, NOW(), NOW())`,
        [userId, addr, hashed, first, `${first} Adversarial`],
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
      return { userId, orgUserId, email: addr };
    };

    const seedCourse = async (orgId: string, creatorOrgUserId: string, title: string) => {
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO courses (
           id, title, description, status, created_by_org_user_id, organization_id,
           type, is_global, review_required, created_at, updated_at
         ) VALUES ($1, $2, 'adversarial fixture', 'published'::"CourseStatus", $3, $4, 'text'::"CourseType", false, false, NOW(), NOW())`,
        [id, title, creatorOrgUserId, orgId],
      );
      await client.query(
        `INSERT INTO lessons (id, course_id, title, content, "order", media_status, created_at, updated_at)
         VALUES ($1, $2, 'Module 1', '<p>Material.</p>', 0, 'ready'::"MediaStatus", NOW(), NOW())`,
        [crypto.randomUUID(), id],
      );
      courseIds.push(id);
      return id;
    };

    const seedEnrollment = async (
      orgUserId: string,
      courseId: string,
      facilityId: string,
      status: string,
    ) => {
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO enrollments (id, organization_user_id, course_id, facility_id, status, progress, score, started_at, locked_at, completed_at)
         VALUES ($1, $2, $3, $4, $5::"EnrollmentStatus", 100, 40, NOW(),
                 CASE WHEN $5 = 'locked' THEN NOW() ELSE NULL END,
                 CASE WHEN $5 = 'completed' THEN NOW() ELSE NULL END)`,
        [id, orgUserId, courseId, facilityId, status],
      );
      return id;
    };

    const orgA = await seedOrg('a');
    const orgB = await seedOrg('b');
    const facA1 = await seedFacility(orgA, 'Adv A1');
    const facA2 = await seedFacility(orgA, 'Adv A2');
    const facB = await seedFacility(orgB, 'Adv B');

    const ownerA = await seedMember(orgA, facA1, 'owner', 'Olga');
    const supervisorA1 = await seedMember(orgA, facA1, 'supervisor', 'Sven');
    const learnerA1 = await seedMember(orgA, facA1, 'nurse', 'Lena');
    const learnerA2 = await seedMember(orgA, facA2, 'nurse', 'Lars');
    const ownerB = await seedMember(orgB, facB, 'owner', 'Bea');
    const learnerB = await seedMember(orgB, facB, 'nurse', 'Bram');

    const tagTitle = (s: string) => `${s} ${tag}`;
    const cLocked = await seedCourse(orgA, ownerA.orgUserId, tagTitle('Adv Locked Course'));
    const cDone = await seedCourse(orgA, ownerA.orgUserId, tagTitle('Adv Completed Course'));
    const cActive = await seedCourse(orgA, ownerA.orgUserId, tagTitle('Adv Active Course'));
    const titleA2 = tagTitle('Adv Other Learner Secret Course');
    const cA2 = await seedCourse(orgA, ownerA.orgUserId, titleA2);
    const titleB = tagTitle('Adv Other Org Secret Course');
    const cB = await seedCourse(orgB, ownerB.orgUserId, titleB);

    const lockedA1 = await seedEnrollment(learnerA1.orgUserId, cLocked, facA1, 'locked');
    const completedA1 = await seedEnrollment(learnerA1.orgUserId, cDone, facA1, 'completed');
    const inProgressA1 = await seedEnrollment(learnerA1.orgUserId, cActive, facA1, 'in_progress');
    const lockedA2 = await seedEnrollment(learnerA2.orgUserId, cA2, facA2, 'locked');
    const lockedB = await seedEnrollment(learnerB.orgUserId, cB, facB, 'locked');

    return {
      orgIds,
      userIds,
      orgUserIds,
      courseIds,
      facilityIds,
      ownerA,
      supervisorA1,
      learnerA1,
      learnerA2,
      learnerB,
      lockedA1,
      completedA1,
      inProgressA1,
      lockedA2,
      lockedB,
      titles: { a2: titleA2, b: titleB },
    };
  } finally {
    await client.end();
  }
}

async function cleanup(f: Fixture): Promise<void> {
  const client = await db();
  try {
    const ofCourses = `SELECT id FROM enrollments WHERE course_id = ANY($1)`;
    await client.query(`DELETE FROM reminder_logs WHERE enrollment_id IN (${ofCourses})`, [
      f.courseIds,
    ]);
    await client.query(`DELETE FROM reminder_nudges WHERE enrollment_id IN (${ofCourses})`, [
      f.courseIds,
    ]);
    await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1)`, [f.courseIds]);
    await client.query(`DELETE FROM lessons WHERE course_id = ANY($1)`, [f.courseIds]);
    await client.query(`DELETE FROM courses WHERE id = ANY($1)`, [f.courseIds]);
    await client.query(`DELETE FROM notifications WHERE organization_user_id = ANY($1)`, [
      f.orgUserIds,
    ]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = ANY($1)`, [f.orgIds]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id = ANY($1)`,
      [f.orgUserIds],
    );
    await client.query(`DELETE FROM organization_users WHERE id = ANY($1)`, [f.orgUserIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [f.userIds]);
    await client.query(`DELETE FROM facilities WHERE id = ANY($1)`, [f.facilityIds]);
    await client.query(`DELETE FROM organizations WHERE id = ANY($1)`, [f.orgIds]);
  } finally {
    await client.end();
  }
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await db();
  try {
    const { rows } = await client.query(sql, params);
    return rows as T[];
  } finally {
    await client.end();
  }
}

async function enrollmentRow(id: string) {
  const [row] = await query<{
    status: string;
    score: number | null;
    retry_requested_at: Date | null;
  }>(`SELECT status::text AS status, score, retry_requested_at FROM enrollments WHERE id = $1`, [
    id,
  ]);
  return row;
}

async function retakeCount(ids: string[]): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM enrollments WHERE retake_of = ANY($1)`,
    [ids],
  );
  return row.n;
}

async function noticeCount(orgUserId: string, enrollmentId: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE organization_user_id = $1 AND type = 'COURSE_RETRY_REQUESTED'
        AND metadata->>'enrollmentId' = $2`,
    [orgUserId, enrollmentId],
  );
  return row.n;
}

async function signIn(browser: Browser, addr: string, landing: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', addr);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(landing, { timeout: 45000 });
  return page;
}

/**
 * Click a real control, abort the Server Action POST it fires (so nothing is
 * written), and return the action's id for hand-made replays.
 */
async function captureActionId(
  page: Page,
  enrollmentId: string,
  click: () => Promise<void>,
): Promise<string> {
  let actionId = '';
  await page.route('**/*', async (route) => {
    const req = route.request();
    const id = req.headers()['next-action'];
    // The page fires other actions of its own; only the one carrying our
    // enrolment id is the control's.
    if (req.method() === 'POST' && id && !actionId && req.postData()?.includes(enrollmentId)) {
      actionId = id;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await click();
  await expect.poll(() => actionId, { timeout: 15000 }).not.toBe('');
  await page.unroute('**/*');
  return actionId;
}

async function replayAction(
  page: Page,
  actionId: string,
  args: unknown[],
): Promise<{ status: number; body: string }> {
  const res = await page.request.post(page.url(), {
    headers: {
      'next-action': actionId,
      'content-type': 'text/plain;charset=UTF-8',
      accept: 'text/x-component',
    },
    data: JSON.stringify(args),
  });
  return { status: res.status(), body: await res.text() };
}

test.describe.configure({ mode: 'serial' });

test.describe('Retry request: adversarial probes (SEC-18, SEC-19)', () => {
  test.beforeAll(async () => {
    fx = await seedFixture();
  });

  test.afterAll(async () => {
    if (fx) await cleanup(fx);
  });

  test('SEC-18: a learner cannot reset a completed, in-progress or someone else’s enrolment', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const learner = await signIn(browser, fx.learnerA1.email, '**/worker**');
    await learner.goto(`/worker/trainings`);
    const lockedRow = await enrollmentRow(fx.lockedA1);
    expect(lockedRow.status).toBe('locked');

    // The genuine control is on the locked course's page; capture its action id.
    await learner.goto(`/worker/courses/${(await courseIdOf(fx.lockedA1)) ?? ''}`);
    const actionId = await captureActionId(learner, fx.lockedA1, () =>
      learner.getByRole('button', { name: 'Request retry' }).click(),
    );
    // Aborted, so the genuine request wrote nothing.
    expect((await enrollmentRow(fx.lockedA1)).retry_requested_at).toBeNull();

    const hostile: Array<[string, string]> = [
      ['completed', fx.completedA1],
      ['in_progress', fx.inProgressA1],
      ['another learner in the same org (locked)', fx.lockedA2],
      ['another org (locked)', fx.lockedB],
    ];

    for (const [label, id] of hostile) {
      const before = await enrollmentRow(id);
      const res = await replayAction(learner, actionId, [id]);
      expect(res.body, `${label}: must be refused`).toContain('"success":false');
      expect(res.body, `${label}: must not report success`).not.toContain('"success":true');
      const after = await enrollmentRow(id);
      expect(after, `${label}: row must be untouched`).toEqual(before);
    }
    // The two own-record refusals specifically did not reopen or stamp anything.
    expect((await enrollmentRow(fx.completedA1)).status).toBe('completed');
    expect((await enrollmentRow(fx.inProgressA1)).status).toBe('in_progress');
    expect((await enrollmentRow(fx.inProgressA1)).score).toBe(40);
    expect(await noticeCountForAnyone(fx.completedA1)).toBe(0);
    expect(await noticeCountForAnyone(fx.inProgressA1)).toBe(0);

    // Garbage ids are refused too, not thrown into a 500.
    const garbage = await replayAction(learner, actionId, ['not-a-uuid']);
    expect(garbage.body).toContain('"success":false');

    await learner.context().close();
  });

  test('SEC-19: an admin cannot grant a retake on another org’s enrolment, nor a supervisor outside their facilities', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const owner = await signIn(browser, fx.ownerA.email, '**/dashboard**');
    await owner.goto(`/dashboard/staff/${fx.learnerA1.orgUserId}?retake=${fx.lockedA1}`);
    const dialog = owner.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Assign Retake' })).toBeVisible();
    const actionId = await captureActionId(owner, fx.lockedA1, () =>
      dialog.getByRole('button', { name: 'Assign Retake' }).click(),
    );
    expect(await retakeCount([fx.lockedA1])).toBe(0);

    // Org A admin, org B enrolment: the not-found shape, and nothing created.
    const cross = await replayAction(owner, actionId, [fx.lockedB]);
    expect(cross.body).toContain('"success":false');
    expect(cross.body).toContain(NOT_FOUND_MESSAGE);
    expect(await retakeCount([fx.lockedB])).toBe(0);
    // Indistinguishable from an id that does not exist at all.
    const missing = await replayAction(owner, actionId, [crypto.randomUUID()]);
    expect(missing.body).toContain(NOT_FOUND_MESSAGE);

    // Same-org admin may reach a same-org learner in ANY facility (control).
    // (Not exercised with a write here: the grant itself is covered in
    // retry-request.spec.ts.)

    // A supervisor of facility A1 reaching for the learner of facility A2.
    const supervisor = await signIn(browser, fx.supervisorA1.email, '**/dashboard**');
    const outside = await replayAction(supervisor, actionId, [fx.lockedA2]);
    expect(outside.body).toContain('"success":false');
    expect(outside.body).toContain(OUTSIDE_FACILITY_MESSAGE);
    expect(await retakeCount([fx.lockedA2])).toBe(0);

    // And cross-org from the supervisor, too.
    const supCross = await replayAction(supervisor, actionId, [fx.lockedB]);
    expect(supCross.body).toContain(NOT_FOUND_MESSAGE);
    expect(await retakeCount([fx.lockedB])).toBe(0);

    await owner.context().close();
    await supervisor.context().close();
  });

  test('deep link: ?retake= naming another learner’s or another org’s enrolment opens nothing and leaks nothing', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const owner = await signIn(browser, fx.ownerA.email, '**/dashboard**');

    const probes: Array<[string, string]> = [
      ['another learner in the same org', fx.lockedA2],
      ['another org', fx.lockedB],
      ['a completed own enrolment', fx.completedA1],
      ['garbage', 'not-an-enrollment-id'],
    ];
    for (const [label, id] of probes) {
      await owner.goto(`/dashboard/staff/${fx.learnerA1.orgUserId}?retake=${id}`);
      // The page must have rendered the learner's profile (the heading is in the
      // DOM; Playwright reports it hidden while the shell is still settling).
      await expect(owner.getByRole('heading', { name: 'Lena Adversarial' })).toHaveCount(1);
      await expect(owner.getByRole('dialog'), `${label}: no dialog`).toHaveCount(0);
      const html = await owner.content();
      expect(html, `${label}: no foreign course leaked`).not.toContain(fx.titles.a2);
      expect(html, `${label}: no foreign course leaked`).not.toContain(fx.titles.b);
    }

    // A foreign profile id with a valid enrolment of ANOTHER learner: still no dialog.
    await owner.goto(`/dashboard/staff/${fx.learnerA2.orgUserId}?retake=${fx.lockedA1}`);
    await expect(owner.getByRole('dialog')).toHaveCount(0);

    // Another org's profile is not found for this admin at all.
    const foreign = await owner.goto(
      `/dashboard/staff/${fx.learnerB.orgUserId}?retake=${fx.lockedB}`,
    );
    expect((await owner.content()) + String(foreign?.status())).not.toContain(fx.titles.b);
    await expect(owner.getByRole('dialog')).toHaveCount(0);

    // Positive control: the legitimate id does open it.
    await owner.goto(`/dashboard/staff/${fx.learnerA1.orgUserId}?retake=${fx.lockedA1}`);
    await expect(
      owner.getByRole('dialog').getByRole('heading', { name: 'Assign Retake' }),
    ).toBeVisible();

    await owner.context().close();
  });

  test('cool-down: simultaneous requests notify once; a repeat inside 72h is silent, one after 72h notifies again', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const learner = await signIn(browser, fx.learnerA1.email, '**/worker**');
    await learner.goto(`/worker/courses/${(await courseIdOf(fx.lockedA1)) ?? ''}`);
    const actionId = await captureActionId(learner, fx.lockedA1, () =>
      learner.getByRole('button', { name: 'Request retry' }).click(),
    );
    expect((await enrollmentRow(fx.lockedA1)).retry_requested_at).toBeNull();

    // Two requests at the same instant.
    const [r1, r2] = await Promise.all([
      replayAction(learner, actionId, [fx.lockedA1]),
      replayAction(learner, actionId, [fx.lockedA1]),
    ]);
    const bodies = [r1.body, r2.body];
    expect(bodies.every((b) => b.includes('"success":true'))).toBe(true);
    expect(bodies.filter((b) => b.includes('"alreadyRequested":true'))).toHaveLength(1);

    const stampedAt = (await enrollmentRow(fx.lockedA1)).retry_requested_at;
    expect(stampedAt).not.toBeNull();
    expect((await enrollmentRow(fx.lockedA1)).status).toBe('locked');
    // Owner (org-wide) and the facility-A1 supervisor each hear exactly once;
    // the learner and the other facility's people never do.
    expect(await noticeCount(fx.ownerA.orgUserId, fx.lockedA1)).toBe(1);
    expect(await noticeCount(fx.supervisorA1.orgUserId, fx.lockedA1)).toBe(1);
    expect(await noticeCount(fx.learnerA1.orgUserId, fx.lockedA1)).toBe(0);

    // Inside the cool-down (71h ago): silent, stamp unchanged.
    await query(
      `UPDATE enrollments SET retry_requested_at = NOW() - INTERVAL '71 hours' WHERE id = $1`,
      [fx.lockedA1],
    );
    const inside = await enrollmentRow(fx.lockedA1);
    const repeat = await replayAction(learner, actionId, [fx.lockedA1]);
    expect(repeat.body).toContain('"alreadyRequested":true');
    expect((await enrollmentRow(fx.lockedA1)).retry_requested_at).toEqual(
      inside.retry_requested_at,
    );
    expect(await noticeCount(fx.ownerA.orgUserId, fx.lockedA1)).toBe(1);

    // Past the cool-down (73h ago): a fresh request, a second notice.
    await query(
      `UPDATE enrollments SET retry_requested_at = NOW() - INTERVAL '73 hours' WHERE id = $1`,
      [fx.lockedA1],
    );
    const again = await replayAction(learner, actionId, [fx.lockedA1]);
    expect(again.body).toContain('"success":true');
    expect(again.body).not.toContain('"alreadyRequested":true');
    expect(await noticeCount(fx.ownerA.orgUserId, fx.lockedA1)).toBe(2);
    expect(await noticeCount(fx.supervisorA1.orgUserId, fx.lockedA1)).toBe(2);

    // A supervisor of facility A2 would not exist here; the learner in A2 has
    // nobody but the org-wide owner to hear about them.
    await learner.context().close();
  });
});

async function courseIdOf(enrollmentId: string): Promise<string | undefined> {
  const [row] = await query<{ course_id: string }>(
    `SELECT course_id FROM enrollments WHERE id = $1`,
    [enrollmentId],
  );
  return row?.course_id;
}

async function noticeCountForAnyone(enrollmentId: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE type = 'COURSE_RETRY_REQUESTED' AND metadata->>'enrollmentId' = $1`,
    [enrollmentId],
  );
  return row.n;
}
