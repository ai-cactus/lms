/**
 * E2E spec: certificate PDF export (src/lib/certificate-export.ts).
 *
 * Tier 3 item 5.2 (perf/tier3-app-optimization) switched exportCertificatePdf's
 * `toPng`/`jsPDF` imports from static to
 * `await Promise.all([import('html-to-image'), import('jspdf')])`, deferring
 * both libraries until a certificate is actually exported. This spec proves
 * the click-to-download flow still works end-to-end in a real browser (real
 * <canvas>, real dynamic `import()` — none of this is mockable in jsdom, see
 * src/lib/certificate-export.test.ts for the mocked unit coverage of the
 * call-argument contract).
 *
 * The Certificate row is seeded directly via raw SQL rather than driven
 * through the real issue-certificate flow, because issueCertificate()
 * uploads the generated PDF to object storage (GCS/MinIO) — an environment
 * dependency this spec doesn't need, since exportCertificatePdf re-rasterizes
 * fresh from the on-screen DOM node on every click regardless of
 * pdfStoragePath (see quiz-retake-attestation.spec.ts's header comment for
 * the same MinIO caveat on the issuance path).
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for seeding + cleanup.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

interface Seeded {
  orgId: string;
  facilityId: string;
  userId: string;
  courseId: string;
  enrollmentId: string;
  certificateId: string;
  email: string;
  password: string;
}

async function seedCertificateFixture(): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const slug = `cert-export-${crypto.randomBytes(4).toString('hex')}`;
    const email = `${slug}@example.com`;
    const password = 'TestPassword123!';
    const hashed = await bcrypt.hash(password, 10);

    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();
    const certificateId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Cert Export Test ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Cert Export Test Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'nurse'::"UserRole", true, $4, $5, NOW(), NOW())`,
      [userId, email, hashed, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Cert', 'Export', 'Cert Export Worker'],
    );
    await client.query(
      `INSERT INTO courses (id, title, created_by, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'published'::"CourseStatus", NOW(), NOW())`,
      [courseId, 'E2E Certificate Export Course', userId],
    );
    await client.query(
      `INSERT INTO enrollments (id, user_id, course_id, status, progress, score, started_at, completed_at)
       VALUES ($1, $2, $3, 'completed'::"EnrollmentStatus", 100, 95, NOW(), NOW())`,
      [enrollmentId, userId, courseId],
    );
    await client.query(
      `INSERT INTO certificates (id, enrollment_id, user_id, course_id, issued_at, score)
       VALUES ($1, $2, $3, $4, NOW(), 95)`,
      [certificateId, enrollmentId, userId, courseId],
    );
    // WorkerLayout gates the entire /worker portal (including /worker/certificates)
    // behind an active subscription — a raw-seeded org with no subscriptions row
    // renders WorkerBillingBlockedScreen instead of the real page. See
    // worker-billing-gate.spec.ts's seedWorker() for the column list this mirrors.
    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, stripe_subscription_id, stripe_price_id, plan,
         billing_cycle, status, current_period_start, current_period_end,
         cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'growth'::"SubscriptionPlan", 'yearly'::"SubscriptionBillingCycle",
         'active'::"SubscriptionStatus", NOW(), NOW() + INTERVAL '30 days', false, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        orgId,
        `sub_e2e_${crypto.randomBytes(6).toString('hex')}`,
        `price_e2e_${crypto.randomBytes(6).toString('hex')}`,
      ],
    );

    return { orgId, facilityId, userId, courseId, enrollmentId, certificateId, email, password };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [seeded.orgId]);
    await client.query(`DELETE FROM certificates WHERE id = $1`, [seeded.certificateId]);
    await client.query(`DELETE FROM enrollments WHERE id = $1`, [seeded.enrollmentId]);
    await client.query(`DELETE FROM courses WHERE id = $1`, [seeded.courseId]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

test.describe('Certificate PDF export', () => {
  // Pre-existing product bug found while writing this spec (not caused by Tier 3
  // 5.2 and not fixed here — bug-hunter tests/reports, it doesn't fix product
  // code): at the project's default 1280x720 e2e viewport, CertificateModal's
  // centered certificate-preview card can render taller than the space left by
  // the dialog's `py-20` padding, pushing it up over the fixed top-right
  // "Export PDF"/Close button bar and making those buttons unclickable —
  // reproduced with a screenshot showing the card visually overlapping the
  // buttons. A taller viewport avoids the overlap so this spec can still guard
  // the dynamic-import → export → download contract; the layout bug itself
  // should be reported separately for a real fix.
  test.use({ viewport: { width: 1280, height: 1100 } });

  let seeded: Seeded;

  test.beforeAll(async () => {
    seeded = await seedCertificateFixture();
  });

  test.afterAll(async () => {
    await cleanup(seeded);
  });

  test('clicking Export PDF on an earned certificate downloads a PDF via the lazy-loaded jspdf/html-to-image chunk', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', seeded.email);
    await page.fill('input[type="password"]', seeded.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/worker');

    await page.goto('/worker/certificates');
    await page
      .getByRole('button', { name: 'View certificate for E2E Certificate Export Course' })
      .click();

    const exportButton = page.getByRole('button', { name: /export pdf/i });
    await expect(exportButton).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
  });
});
