/**
 * Tests for the PHI evidence report (F-092).
 *
 * The report exists to answer a challenge, so the tests are mostly about it
 * refusing to overstate. `attestable` must be false whenever the claim would be
 * unsupported — including the subtle case where the ledger only covers part of
 * the requested period, which is easy to get wrong and produces a confidently
 * wrong attestation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    phiDecision: { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/generated/prisma/client', () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({ strings, v }) },
}));

import { buildPhiEvidenceReport } from './phiEvidence';

const FROM = new Date('2026-07-01T00:00:00.000Z');
const TO = new Date('2026-07-31T23:59:59.000Z');

/** groupBy(['outcome']) shape. */
function outcomes(counts: Record<string, number>) {
  return Object.entries(counts).map(([outcome, n]) => ({ outcome, _count: { _all: n } }));
}

/** groupBy(['outcome','decidedBy']) shape. */
function layers(rows: [string, string, number][]) {
  return rows.map(([outcome, decidedBy, n]) => ({ outcome, decidedBy, _count: { _all: n } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.phiDecision.groupBy
    .mockResolvedValueOnce(outcomes({ allowed: 100, blocked_phi: 7, blocked_scan_failed: 2 }))
    .mockResolvedValueOnce(
      layers([
        ['allowed', 'ai', 96],
        ['allowed', 'skipped_short', 4],
        ['blocked_phi', 'local_regex', 5],
        ['blocked_phi', 'ai', 2],
        ['blocked_scan_failed', 'ai', 2],
      ]),
    );
  // Ledger predates the window, so the whole period is covered.
  prismaMock.phiDecision.findFirst.mockResolvedValue({ createdAt: new Date('2026-06-01') });
  prismaMock.phiDecision.findMany.mockResolvedValue([
    { findingTypes: ['SSN'] },
    { findingTypes: ['EMAIL', 'SSN'] },
  ]);
  prismaMock.$queryRaw.mockResolvedValue([{ count: 0n }]);
});

describe('buildPhiEvidenceReport — aggregation', () => {
  it('totals each outcome', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.totals).toEqual({
      decisions: 109,
      allowed: 100,
      blockedPhi: 7,
      blockedScanFailed: 2,
    });
  });

  it('counts only local_regex blocks as zero-transmission', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    // 5 rejected without a byte reaching Google; 2 required the Vertex scan.
    expect(report.detection.blockedWithZeroTransmission).toBe(5);
    expect(report.detection.blockedByAiScan).toBe(2);
  });

  it('surfaces skipped-short separately from scanned-and-clean', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    // Folding these into "allowed" would overstate scan coverage: this text was
    // never actually scanned.
    expect(report.detection.skippedShort).toBe(4);
  });

  it('de-duplicates and sorts observed finding types', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });
    expect(report.detection.findingTypes).toEqual(['EMAIL', 'SSN']);
  });
});

describe('buildPhiEvidenceReport — the attestation', () => {
  it('attests when every accepted version has a decision row', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.integrity.acceptedWithoutDecision).toBe(0);
    expect(report.integrity.attestable).toBe(true);
  });

  // The load-bearing case: content accepted with no decision row means the
  // ledger has a hole and no claim can be made.
  it('refuses to attest when an accepted version has no decision row', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: 3n }]);

    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.integrity.acceptedWithoutDecision).toBe(3);
    expect(report.integrity.attestable).toBe(false);
  });

  /**
   * The subtle one. If the ledger only started mid-period, versions stored
   * earlier legitimately have no decision rows — so the anti-join is scoped to
   * the covered window and would report 0, which reads as a clean bill of
   * health for a period that was never covered.
   */
  it('refuses to attest when the ledger covers only part of the period', async () => {
    prismaMock.phiDecision.findFirst.mockResolvedValue({
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    });

    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.integrity.acceptedWithoutDecision).toBe(0);
    expect(report.integrity.attestable).toBe(false);
    expect(report.coverageFrom).toBe('2026-07-15T00:00:00.000Z');
  });

  it('refuses to attest against an empty ledger', async () => {
    prismaMock.phiDecision.findFirst.mockResolvedValue(null);
    prismaMock.phiDecision.groupBy.mockReset();
    prismaMock.phiDecision.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.phiDecision.findMany.mockResolvedValue([]);

    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.coverageFrom).toBeNull();
    expect(report.integrity.attestable).toBe(false);
    // No ledger means nothing to anti-join against — the query is skipped.
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('buildPhiEvidenceReport — scoping', () => {
  it('scopes every aggregate to one organization when given', async () => {
    await buildPhiEvidenceReport({ organizationId: 'org-1', from: FROM, to: TO });

    for (const call of prismaMock.phiDecision.groupBy.mock.calls) {
      expect(call[0].where).toMatchObject({ organizationId: 'org-1' });
    }
    expect(prismaMock.phiDecision.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-1',
    });
  });

  it('reports across all organizations when none is given', async () => {
    const report = await buildPhiEvidenceReport({ from: FROM, to: TO });

    expect(report.organizationId).toBeNull();
    expect(prismaMock.phiDecision.groupBy.mock.calls[0][0].where).not.toHaveProperty(
      'organizationId',
    );
  });
});
