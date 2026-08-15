/**
 * Evidence report over the PHI-decision ledger (F-092).
 *
 * The point of this report is not to count rows — it is to answer a challenge.
 * If someone alleges PHI entered the system, the useful artefact is not "we
 * blocked 43 documents", it is:
 *
 *   "Between these dates, every document accepted into storage has a scan
 *    decision recorded against it. Here are zero exceptions."
 *
 * So `integrity.acceptedWithoutDecision` is the load-bearing number and it must
 * be 0. Everything else is context.
 *
 * Honesty constraints deliberately built in:
 *  - `coverageFrom` is reported, and the invariant is only asserted from that
 *    point. Document versions stored before the ledger existed cannot have
 *    decision rows, and a report that quietly ignored them would be misleading.
 *  - `skippedShort` is surfaced separately rather than folded into "allowed":
 *    text below the scanner's minimum length is never actually scanned, and
 *    filing that under "scanned and clean" would overstate coverage.
 *  - `blockedWithZeroTransmission` counts only `local_regex` decisions, which
 *    are the ones where nothing reached Google at all.
 */

import prisma from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';

export interface PhiEvidenceQuery {
  /** Omit to report across all organizations (system-admin scope). */
  organizationId?: string;
  from: Date;
  to: Date;
}

export interface PhiEvidenceReport {
  period: { from: string; to: string };
  organizationId: string | null;
  /**
   * Earliest decision ever recorded. The integrity assertion below is only
   * meaningful for content stored at or after this instant; null means the
   * ledger is empty and nothing can be attested yet.
   */
  coverageFrom: string | null;
  totals: {
    decisions: number;
    allowed: number;
    blockedPhi: number;
    blockedScanFailed: number;
  };
  detection: {
    /** Blocked by the deterministic local pass — nothing transmitted to any AI provider. */
    blockedWithZeroTransmission: number;
    /** Blocked by the BAA-covered Vertex scan. */
    blockedByAiScan: number;
    /** Accepted without a scan because the text was below the minimum length. */
    skippedShort: number;
    /** Distinct finding types observed, e.g. ['EMAIL','SSN']. */
    findingTypes: string[];
  };
  integrity: {
    /**
     * Document versions stored within the period, at or after `coverageFrom`,
     * that have NO decision row. MUST be 0 — a non-zero value means content was
     * accepted without attested scanning, and the attestation below is void.
     */
    acceptedWithoutDecision: number;
    /** True only when the above is 0 and the ledger covers the whole period. */
    attestable: boolean;
  };
}

type GroupRow = { outcome: string; _count: { _all: number } };

function countFor(rows: GroupRow[], outcome: string): number {
  return rows.find((r) => r.outcome === outcome)?._count._all ?? 0;
}

export async function buildPhiEvidenceReport(query: PhiEvidenceQuery): Promise<PhiEvidenceReport> {
  const { organizationId, from, to } = query;
  const scope = {
    createdAt: { gte: from, lte: to },
    ...(organizationId ? { organizationId } : {}),
  };

  const [byOutcome, byDecidedBy, earliest, typeRows] = await Promise.all([
    prisma.phiDecision.groupBy({ by: ['outcome'], where: scope, _count: { _all: true } }),
    prisma.phiDecision.groupBy({
      by: ['outcome', 'decidedBy'],
      where: scope,
      _count: { _all: true },
    }),
    // Ledger coverage start is a property of the ledger, not of the period.
    prisma.phiDecision.findFirst({
      where: organizationId ? { organizationId } : {},
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.phiDecision.findMany({ where: scope, select: { findingTypes: true } }),
  ]);

  const decidedBy = (outcome: string, layer: string): number =>
    byDecidedBy
      .filter((r) => r.outcome === outcome && r.decidedBy === layer)
      .reduce((sum, r) => sum + r._count._all, 0);

  const coverageFrom = earliest?.createdAt ?? null;

  // Only assert the invariant over the window the ledger actually covers.
  const assertFrom = coverageFrom && coverageFrom > from ? coverageFrom : from;
  const acceptedWithoutDecision = coverageFrom
    ? await countAcceptedWithoutDecision(assertFrom, to)
    : 0;

  const findingTypes = [...new Set(typeRows.flatMap((r) => r.findingTypes))].sort();

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    organizationId: organizationId ?? null,
    coverageFrom: coverageFrom ? coverageFrom.toISOString() : null,
    totals: {
      decisions: byOutcome.reduce((sum, r) => sum + r._count._all, 0),
      allowed: countFor(byOutcome, 'allowed'),
      blockedPhi: countFor(byOutcome, 'blocked_phi'),
      blockedScanFailed: countFor(byOutcome, 'blocked_scan_failed'),
    },
    detection: {
      blockedWithZeroTransmission: decidedBy('blocked_phi', 'local_regex'),
      blockedByAiScan: decidedBy('blocked_phi', 'ai'),
      skippedShort: decidedBy('allowed', 'skipped_short'),
      findingTypes,
    },
    integrity: {
      acceptedWithoutDecision,
      // Attestable only if nothing slipped through AND the ledger covers the
      // whole requested period rather than part of it.
      attestable: acceptedWithoutDecision === 0 && !!coverageFrom && coverageFrom <= from,
    },
  };
}

/**
 * Anti-join: stored document versions with no decision row.
 *
 * Raw SQL because `PhiDecision.documentVersionId` is intentionally NOT a foreign
 * key — the ledger must outlive the documents it describes, so Prisma has no
 * relation to traverse. Parameterised via the tagged template.
 */
async function countAcceptedWithoutDecision(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM document_versions dv
    WHERE dv.created_at >= ${from}
      AND dv.created_at <= ${to}
      AND NOT EXISTS (
        SELECT 1 FROM phi_decisions pd
        WHERE pd.document_version_id = dv.id
      )
  `);
  return Number(rows[0]?.count ?? 0);
}
