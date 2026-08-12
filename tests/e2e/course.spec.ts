import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SEEDED_COURSE_TITLE = 'E2E Compliance Training';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function loginAsAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test.describe('Course Flows', () => {
  test('ENG-022: admin assigns a retake for a locked enrollment', async ({ page }) => {
    await loginAsAdmin(page);

    // Open the seeded course; the row navigates to its training-detail page,
    // which lists enrolled staff with a per-row kebab (⋮) actions menu.
    await page.goto('/dashboard/courses');
    await page.getByText(SEEDED_COURSE_TITLE).first().click();
    await page.waitForURL('**/training/courses/**');

    // Regression guard for the bug this test used to exercise: assignRetake()
    // only accepts a `locked` enrollment, and TrainingDetails.tsx now disables
    // the "Assign Retake" item (data-disabled, per Radix) for any other
    // status. Sarah's seeded enrollment is `in_progress` — confirm her item
    // stays disabled before touching the worker's (locked) row.
    const sarahRow = page.getByRole('row', { name: /sarah johnson/i });
    await sarahRow.getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Assign Retake' })).toHaveAttribute(
      'data-disabled',
      '',
    );
    // Close the menu (Escape) before opening the worker's.
    await page.keyboard.press('Escape');

    // The seeded worker's enrollment is `locked` (quiz attempts exhausted,
    // failing score) — the surface assignRetake() is actually built for.
    const workerRow = page.getByRole('row', { name: /test worker/i });
    await workerRow.getByRole('button', { name: 'Row actions' }).click();
    const assignRetakeItem = page.getByRole('menuitem', { name: 'Assign Retake' });
    await expect(assignRetakeItem).not.toHaveAttribute('data-disabled', '');
    await assignRetakeItem.click();

    // The Assign Retake dialog opens. Scope to the dialog's title heading —
    // the dialog also contains a same-labelled "Assign Retake" submit button,
    // so a plain getByText match is ambiguous (strict-mode violation).
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Assign Retake' })).toBeVisible();

    // Complete the modal: an optional reason, then confirm.
    await dialog
      .getByLabel(/reason for retake/i)
      .fill('Granted after review — E2E regression test');
    await dialog.getByRole('button', { name: 'Assign Retake' }).click();

    // Success outcome (AssignRetakeModal.tsx): no confirmation toast — the
    // dialog closes and the page refreshes via router.refresh(). assignRetake()
    // creates a NEW `enrolled` enrollment row (retakeOf the locked one), so the
    // worker now has two rows in this table: the original locked attempt and
    // the fresh retake.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: /test worker/i })).toHaveCount(2);
  });

  test('ENG-024: Course creation wizard resets its state on unmount', async ({ page }) => {
    await loginAsAdmin(page);

    // The wizard is a full-page route (/dashboard/courses/create), not a modal.
    await page.goto('/dashboard/courses');
    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.waitForURL('**/dashboard/courses/create');
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();

    // Step 1 — pick a (system) category so "Next Step" enables.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Next Step' }).click();

    // Step 2 — the document picker (shadcn Checkbox). Select the seeded doc.
    // We intentionally do NOT advance past Step 2 (that triggers AI document
    // analysis, which is unavailable in CI).
    await expect(page.getByText(/step 2 of 7/i)).toBeVisible();
    await page.getByRole('checkbox').first().click();

    // Leave the wizard (unmount) without finishing, then reopen it.
    await page.goto('/dashboard/courses');
    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.waitForURL('**/dashboard/courses/create');

    // ENG-024 fix: reopening starts a fresh wizard at Step 1 rather than
    // silently resuming at Step 2.
    await expect(page.getByText(/step 1 of 7/i)).toBeVisible();
  });
});

// ── Courses list: Video/Reading Course tabs + registry-gated row actions
// (Figma redesign — multi-facility v3) ──

interface CourseTabsSeeded {
  orgId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  supervisorEmail: string;
  supervisorPassword: string;
  supervisorOrgUserId: string;
  facilityId: string;
  videoCourseTitle: string;
  readingCourseTitle: string;
  documentId: string;
}

function courseTabsUid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@course-tabs-e2e.invalid`;
}

async function seedCourseTabsFixture(): Promise<CourseTabsSeeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const ownerEmail = courseTabsUid('owner');
    const ownerPassword = 'CrsTabs!Owner9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const supervisorEmail = courseTabsUid('supervisor');
    const supervisorPassword = 'CrsTabs!Sup9x';
    const supervisorHashed = await bcrypt.hash(supervisorPassword, 10);
    const slug = `course-tabs-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const supervisorId = crypto.randomUUID();
    const supervisorOrgUserId = crypto.randomUUID();
    const videoCourseTitle = `Video Course ${slug}`;
    const readingCourseTitle = `Reading Course ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Course Tabs E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Course Tabs Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Crs', 'Owner', 'Crs Owner', NOW(), NOW())`,
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
       VALUES ($1, $2, $3, true, 'credentials', 'Crs', 'Supervisor', 'Crs Supervisor', NOW(), NOW())`,
      [supervisorId, supervisorEmail, supervisorHashed],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'supervisor'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [supervisorOrgUserId, supervisorId, orgId],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), supervisorOrgUserId, facilityId],
    );

    const videoCourseId = crypto.randomUUID();
    const readingCourseId = crypto.randomUUID();
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

    // getCourses() (src/app/actions/course.ts) only returns courses the
    // caller's OWN membership created, plus org-wide "offerings" — a
    // supervisor viewing courses THE OWNER created needs an explicit
    // org_course_offerings row per course, same as production onboarding.
    for (const courseId of [videoCourseId, readingCourseId]) {
      await client.query(
        `INSERT INTO org_course_offerings (id, organization_id, course_id, added_by_admin_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [crypto.randomUUID(), orgId, courseId, ownerOrgUserId],
      );
    }

    // Give the video course a source-document lineage (document ->
    // document_version -> course_version) so "View Source Document" has
    // something to gate on — without this, sourceDocumentId resolves to
    // null and that row action never renders regardless of role.
    const documentId = crypto.randomUUID();
    const documentVersionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO documents (id, organization_user_id, filename, original_name, mime_type, size, created_at, updated_at)
       VALUES ($1, $2, 'source.pdf', 'Source Document.pdf', 'application/pdf', 1024, NOW(), NOW())`,
      [documentId, ownerOrgUserId],
    );
    await client.query(
      `INSERT INTO document_versions (id, document_id, version, storage_path, hash, created_at)
       VALUES ($1, $2, 1, 'documents/source.pdf', 'course-tabs-e2e-hash', NOW())`,
      [documentVersionId, documentId],
    );
    await client.query(
      `INSERT INTO course_versions (id, course_id, document_version_id, version, published_at)
       VALUES ($1, $2, $3, 1, NOW())`,
      [crypto.randomUUID(), videoCourseId, documentVersionId],
    );

    return {
      orgId,
      ownerId,
      ownerOrgUserId,
      ownerEmail,
      ownerPassword,
      supervisorEmail,
      supervisorPassword,
      supervisorOrgUserId,
      facilityId,
      videoCourseTitle,
      readingCourseTitle,
      documentId,
    };
  } finally {
    await client.end();
  }
}

async function cleanupCourseTabsFixture(seeded: CourseTabsSeeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // Courses cascade-delete their course_versions; document_versions must
    // go before documents, and both after the courses that reference them.
    await client.query(
      `DELETE FROM courses WHERE created_by_org_user_id = $1 AND title IN ($2, $3)`,
      [seeded.ownerOrgUserId, seeded.videoCourseTitle, seeded.readingCourseTitle],
    );
    await client.query(`DELETE FROM document_versions WHERE document_id = $1`, [
      seeded.documentId,
    ]);
    await client.query(`DELETE FROM documents WHERE id = $1`, [seeded.documentId]);
    await client.query(
      `DELETE FROM organization_user_facilities WHERE organization_user_id IN ($1, $2)`,
      [seeded.ownerOrgUserId, seeded.supervisorOrgUserId],
    );
    await client.query(`DELETE FROM organization_users WHERE id IN ($1, $2)`, [
      seeded.ownerOrgUserId,
      seeded.supervisorOrgUserId,
    ]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.ownerId]);
    await client.query(`DELETE FROM users WHERE email = $1`, [seeded.supervisorEmail]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

interface EmptyTabSeeded {
  orgId: string;
  ownerId: string;
  ownerOrgUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  facilityId: string;
  videoCourseTitle: string;
}

/** A minimal org with only a video course, so the Reading tab is genuinely empty. */
async function seedEmptyTabFixture(): Promise<EmptyTabSeeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const ownerEmail = courseTabsUid('empty-owner');
    const ownerPassword = 'CrsTabs!Empty9';
    const ownerHashed = await bcrypt.hash(ownerPassword, 10);
    const slug = `course-tabs-empty-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const ownerOrgUserId = crypto.randomUUID();
    const videoCourseTitle = `Video Course ${slug}`;

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Course Tabs Empty E2E ${slug}`, slug, ownerEmail],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Course Tabs Empty Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', 'Crs', 'EmptyOwner', 'Crs EmptyOwner', NOW(), NOW())`,
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

    const videoCourseId = crypto.randomUUID();
    await client.query(
      `INSERT INTO courses (id, title, status, created_by_org_user_id, type, is_global, created_at, updated_at)
       VALUES ($1, $2, 'published'::"CourseStatus", $3, 'video'::"CourseType", false, NOW(), NOW())`,
      [videoCourseId, videoCourseTitle, ownerOrgUserId],
    );
    await client.query(
      `INSERT INTO org_course_offerings (id, organization_id, course_id, added_by_admin_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [crypto.randomUUID(), orgId, videoCourseId, ownerOrgUserId],
    );

    return { orgId, ownerId, ownerOrgUserId, ownerEmail, ownerPassword, facilityId, videoCourseTitle };
  } finally {
    await client.end();
  }
}

async function cleanupEmptyTabFixture(seeded: EmptyTabSeeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM courses WHERE created_by_org_user_id = $1 AND title = $2`,
      [seeded.ownerOrgUserId, seeded.videoCourseTitle],
    );
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

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Courses list — Video/Reading Course tabs and role-gated row actions', () => {
  test('owner sees both tabs with correct counts, per-tab columns, and filtered rows', async ({
    page,
  }) => {
    const seeded = await seedCourseTabsFixture();
    try {
      await loginAs(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto('/dashboard/courses');
      await page.waitForLoadState('networkidle');

      // Tab labels carry a Badge count as a separate node, so the accessible
      // name is "Video 1" — NOT the old "Video (1)" format.
      await expect(page.getByRole('tab', { name: 'Video 1' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Reading Course 1' })).toBeVisible();
      await expect(page.getByText(seeded.videoCourseTitle)).toBeVisible();
      await expect(page.getByText(seeded.readingCourseTitle)).not.toBeVisible();

      // Video tab shows Description, not Date Created.
      await expect(page.getByRole('columnheader', { name: 'Description' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Date Created' })).not.toBeVisible();

      await page.getByRole('tab', { name: 'Reading Course 1' }).click();
      await expect(page.getByText(seeded.readingCourseTitle)).toBeVisible();
      await expect(page.getByText(seeded.videoCourseTitle)).not.toBeVisible();

      // Reading tab swaps the column for Date Created.
      await expect(page.getByRole('columnheader', { name: 'Date Created' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Description' })).not.toBeVisible();
    } finally {
      await cleanupCourseTabsFixture(seeded);
    }
  });

  test("owner's kebab menu on the video row shows exactly the four gated items, no Duplicate", async ({
    page,
  }) => {
    const seeded = await seedCourseTabsFixture();
    try {
      await loginAs(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto('/dashboard/courses');
      await page.waitForLoadState('networkidle');

      const row = page.getByRole('row', { name: new RegExp(seeded.videoCourseTitle) });
      await row.getByRole('button', { name: 'Row actions' }).click();

      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Assign to staff' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'View Source Document' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toHaveCount(0);
    } finally {
      await cleanupCourseTabsFixture(seeded);
    }
  });

  test("supervisor (read-only) sees no write items in a course row's kebab menu", async ({
    page,
  }) => {
    const seeded = await seedCourseTabsFixture();
    try {
      await loginAs(page, seeded.supervisorEmail, seeded.supervisorPassword);
      await page.goto('/dashboard/courses');
      await page.waitForLoadState('networkidle');

      const row = page.getByRole('row', { name: new RegExp(seeded.videoCourseTitle) });
      await expect(row).toBeVisible();
      // A read-only supervisor's buildRowActions() resolves to an EMPTY list, so
      // CoursesListClient renders no menu trigger for the row at all — the
      // strongest form of "no write items".
      //
      // The supervisor gets no "View Source Document" either, despite holding
      // document.read: getCourses() selects the source-document lineage only on
      // the `ownCourses` branch (createdByOrgUserId), and a course the viewer
      // did not create reaches them through `offerings`, which omits it on
      // purpose — an adopted offering's document belongs to the publishing org
      // and must never be linked from this tenant. Do NOT "fix" this by adding
      // `versions` to the offerings select: that is a tenancy control, not an
      // oversight.
      await expect(row.getByRole('button', { name: 'Row actions' })).toHaveCount(0);
      // Read access itself is intact — the row still offers View.
      await expect(row.getByRole('link', { name: 'View' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create Course' })).not.toBeVisible();
    } finally {
      await cleanupCourseTabsFixture(seeded);
    }
  });

  test('an empty tab shows the illustrated empty state without hiding the tabs, counts, or search', async ({
    page,
  }) => {
    const seeded = await seedEmptyTabFixture();
    try {
      await loginAs(page, seeded.ownerEmail, seeded.ownerPassword);
      await page.goto('/dashboard/courses');
      await page.waitForLoadState('networkidle');

      // Defaults to Video (the only populated tab).
      await expect(page.getByText(seeded.videoCourseTitle)).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Reading Course 0' })).toBeVisible();

      await page.getByRole('tab', { name: 'Reading Course 0' }).click();

      // Regression guard: the old empty state hid the whole widget. The
      // redesign keeps the tabs, their counts, and the search box rendered
      // above the illustrated panel.
      await expect(page.getByText('No reading courses yet.')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Video 1' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Reading Course 0' })).toBeVisible();
      await expect(page.getByPlaceholder('Search for courses...')).toBeVisible();

      // The secondary CTA switches back to the populated tab.
      await page.getByRole('button', { name: 'View video courses' }).click();
      await expect(page.getByText(seeded.videoCourseTitle)).toBeVisible();
    } finally {
      await cleanupEmptyTabFixture(seeded);
    }
  });
});
