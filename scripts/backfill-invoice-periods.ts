/**
 * Backfill Invoice Service Periods
 *
 * Purpose: Before the invoice-period fix, `handleInvoiceUpsert` in the Stripe
 * webhook persisted Stripe's *invoice-level* `period_start`/`period_end` into
 * `Invoice.periodStart/periodEnd`. For subscription invoices those fields
 * reflect invoice assembly time and are (near-)equal, so the billing-history
 * "Period" column shows the same date for start and end (e.g. "May 14, 2026 –
 * May 14, 2026"). The real service window lives on the invoice line items. This
 * one-off backfill re-fetches each affected invoice from Stripe, re-derives the
 * period via the shared `deriveInvoiceServicePeriod` helper (the same logic the
 * webhook now uses), and rewrites `periodStart`/`periodEnd`.
 *
 * Every `invoices` row was written by the webhook handler (no seed creates
 * invoices), so historical rows need this backfill; new/replayed invoices heal
 * themselves through the fixed webhook.
 *
 * Prerequisites:
 *   - STRIPE_SECRET_KEY  (test- or live-mode key matching the invoices' mode)
 *   - DATABASE_URL       (the environment whose rows you are backfilling)
 *
 * Usage:
 *   npx tsx scripts/backfill-invoice-periods.ts [--dry-run] [--all] [--env-file=path]
 *
 * Flags:
 *   --dry-run   Log the invoices that would be updated without writing changes.
 *   --all       Reprocess every invoice row. Default scope is only rows whose
 *               stored periodStart === periodEnd (the ones this bug produced).
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { deriveInvoiceServicePeriod } from '@/lib/stripe-invoice-period';

/**
 * Minimal .env loader (no deps) — fills process.env WITHOUT overwriting any
 * variable already present in the real environment. Mirrors the loader in
 * scripts/backfill-org-timezones.ts so `npx tsx scripts/backfill-invoice-periods.ts`
 * works standalone (the Prisma client reads DATABASE_URL lazily at query time,
 * so loading env before main() runs is sufficient).
 */
function loadEnvFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

function loadEnv(): void {
  const explicit = process.argv.find((a) => a.startsWith('--env-file='));
  const candidates = [
    explicit ? explicit.slice('--env-file='.length) : null,
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.staging',
  ].filter(Boolean) as string[];
  for (const c of candidates) loadEnvFile(path.resolve(process.cwd(), c));
}

loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');

async function main() {
  logger.info({
    msg: '[backfill-invoice-periods] Starting invoice period backfill',
    dryRun: DRY_RUN,
    all: ALL,
  });

  // Imported dynamically (after loadEnv) because db/index.ts reads
  // process.env.DATABASE_URL eagerly at module-init — a static import would
  // evaluate before loadEnv() runs and default the pg adapter to localhost:5432.
  const { default: prisma } = await import('@/lib/prisma');
  const { getStripeClient } = await import('@/lib/stripe');
  const stripe = getStripeClient();

  const rows = await prisma.invoice.findMany({
    select: { id: true, stripeInvoiceId: true, periodStart: true, periodEnd: true },
  });

  // Default scope: only rows the bug produced (equal start/end). Row counts are
  // small, so filtering in JS after findMany is fine.
  const candidates = ALL
    ? rows
    : rows.filter((row) => row.periodStart.getTime() === row.periodEnd.getTime());

  logger.info({
    msg: '[backfill-invoice-periods] Invoices in scope',
    total: rows.length,
    candidates: candidates.length,
    all: ALL,
  });

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Sequential (rate-limit friendly); one bad invoice must not abort the run.
  for (const row of candidates) {
    try {
      const inv = await stripe.invoices.retrieve(row.stripeInvoiceId);

      if (inv.lines?.has_more) {
        logger.warn({
          msg: '[backfill-invoice-periods] Invoice has more line items than the first page; deriving from first page only',
          stripeInvoiceId: row.stripeInvoiceId,
        });
      }

      const { periodStart, periodEnd } = deriveInvoiceServicePeriod(inv);

      if (
        periodStart.getTime() === row.periodStart.getTime() &&
        periodEnd.getTime() === row.periodEnd.getTime()
      ) {
        skipped += 1;
        continue;
      }

      if (DRY_RUN) {
        logger.info({
          msg: '[backfill-invoice-periods] Would update invoice period',
          stripeInvoiceId: row.stripeInvoiceId,
          from: { periodStart: row.periodStart, periodEnd: row.periodEnd },
          to: { periodStart, periodEnd },
        });
        continue;
      }

      await prisma.invoice.update({
        where: { id: row.id },
        data: { periodStart, periodEnd },
      });
      updated += 1;
      logger.info({
        msg: '[backfill-invoice-periods] Invoice period updated',
        stripeInvoiceId: row.stripeInvoiceId,
        periodStart,
        periodEnd,
      });
    } catch (e) {
      errors += 1;
      logger.error({
        msg: '[backfill-invoice-periods] Failed to backfill invoice',
        stripeInvoiceId: row.stripeInvoiceId,
        err: e,
      });
    }
  }

  logger.info({
    msg: '[backfill-invoice-periods] Backfill complete',
    candidates: candidates.length,
    updated,
    skipped,
    errors,
    dryRun: DRY_RUN,
  });

  // prisma is imported dynamically inside main(); disconnect here while in scope.
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    logger.error({ msg: '[backfill-invoice-periods] Backfill failed', err: e });
    process.exit(1);
  });
