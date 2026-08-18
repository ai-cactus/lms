/**
 * Tests for the PHI-decision ledger (F-092).
 *
 * Two properties matter here and they pull in opposite directions:
 *
 *  1. COMPLETENESS — every scan decision must produce a row, especially the
 *     rejections, because "prove you rejected it" is the question the ledger
 *     exists to answer. The accepted path must be transactional so an accepted
 *     document cannot exist without its decision row.
 *
 *  2. MINIMISATION — a ledger about PHI must not itself become a store of PHI.
 *     No document text, no raw filenames (a filename can carry a patient name),
 *     no raw detected values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const { prismaMock, mockLogger } = vi.hoisted(() => ({
  prismaMock: { phiDecision: { create: vi.fn() } },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { recordPhiDecision, recordPhiDecisionInTransaction, outcomeFromScan } from './phiDecision';
import type { ScanResult } from './phiScanner';

const SSN = '123-45-6789';
const DOC_TEXT = `Patient intake for the quarter. Contact SSN ${SSN} on file.`;
const FILENAME = 'john-doe-intake.pdf';

const cleanScan: ScanResult = { hasPHI: false, findings: [], decidedBy: 'ai' };

const blockedScan: ScanResult = {
  hasPHI: true,
  decidedBy: 'local_regex',
  findings: [{ type: 'SSN', offsetStart: 41, offsetEnd: 52, confidence: 1.0 }],
};

const failedScan: ScanResult = {
  hasPHI: true,
  scanFailed: true,
  findings: [],
  decidedBy: 'ai',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.phiDecision.create.mockResolvedValue({ id: 'dec-1' });
});

describe('outcomeFromScan', () => {
  it('maps a clean scan to allowed', () => {
    expect(outcomeFromScan(cleanScan)).toBe('allowed');
  });

  it('maps a detection to blocked_phi', () => {
    expect(outcomeFromScan(blockedScan)).toBe('blocked_phi');
  });

  // A scan that could not complete is NOT a detection. Conflating them would
  // make a Vertex outage look like a wave of PHI uploads.
  it('maps a failed scan to blocked_scan_failed even though hasPHI is true', () => {
    expect(outcomeFromScan(failedScan)).toBe('blocked_scan_failed');
  });
});

describe('recordPhiDecision — data minimisation', () => {
  it('stores hashes, never the document text or filename', async () => {
    await recordPhiDecision({
      source: 'document_upload',
      scan: blockedScan,
      scannedText: DOC_TEXT,
      filename: FILENAME,
      actorId: 'user-1',
      organizationId: 'org-1',
    });

    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];

    expect(data.contentHash).toBe(createHash('sha256').update(DOC_TEXT, 'utf8').digest('hex'));
    expect(data.filenameHash).toBe(createHash('sha256').update(FILENAME, 'utf8').digest('hex'));
    expect(data.contentLength).toBe(DOC_TEXT.length);

    // Nothing anywhere in the row may contain the text, the filename, or the
    // detected value itself.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(SSN);
    expect(serialized).not.toContain(FILENAME);
    expect(serialized).not.toContain('Patient intake');
  });

  it('records finding types and count but no values', async () => {
    await recordPhiDecision({
      source: 'document_upload',
      scan: {
        hasPHI: true,
        decidedBy: 'ai',
        findings: [
          { type: 'SSN', offsetStart: 1, offsetEnd: 12, confidence: 1 },
          { type: 'EMAIL', offsetStart: 30, offsetEnd: 45, confidence: 0.9 },
          { type: 'SSN', offsetStart: 60, offsetEnd: 71, confidence: 1 },
        ],
      },
      scannedText: DOC_TEXT,
    });

    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];

    // De-duplicated and sorted, so the column is aggregatable.
    expect(data.findingTypes).toEqual(['EMAIL', 'SSN']);
    expect(data.findingCount).toBe(3);
  });

  it('omits the filename hash when no filename was supplied', async () => {
    await recordPhiDecision({
      source: 'course_wizard_upload',
      scan: cleanScan,
      scannedText: DOC_TEXT,
    });

    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];
    expect(data.filenameHash).toBeNull();
  });
});

describe('recordPhiDecision — evidence quality', () => {
  // 'local_regex' is a materially stronger claim than 'ai': it means the
  // content was rejected without a byte leaving the process.
  it('preserves which layer decided', async () => {
    await recordPhiDecision({
      source: 'document_upload',
      scan: blockedScan,
      scannedText: DOC_TEXT,
    });

    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];
    expect(data.decidedBy).toBe('local_regex');
    expect(data.outcome).toBe('blocked_phi');
  });

  it('carries actor, org and source for attribution', async () => {
    await recordPhiDecision({
      source: 'course_wizard_upload',
      scan: cleanScan,
      scannedText: DOC_TEXT,
      actorId: 'user-7',
      organizationId: 'org-9',
    });

    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];
    expect(data).toMatchObject({
      source: 'course_wizard_upload',
      actorId: 'user-7',
      organizationId: 'org-9',
      detectorVersion: 'v2',
    });
  });
});

describe('recordPhiDecision — durability contract', () => {
  /**
   * The blocked path has no transaction to join and the caller is about to
   * return an error anyway. Throwing here would turn a clear "PHI detected"
   * message into a generic failure for no security gain — the user is blocked
   * either way — so it catches and logs loudly instead.
   */
  it('does not throw when the write fails, but logs at error level', async () => {
    prismaMock.phiDecision.create.mockRejectedValue(new Error('db down'));

    await expect(
      recordPhiDecision({
        source: 'document_upload',
        scan: blockedScan,
        scannedText: DOC_TEXT,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [payload] = mockLogger.error.mock.calls[0];
    expect(payload.msg).toContain('FAILED to record PHI decision');
  });

  /**
   * The accepted path is the opposite: it runs inside the upload transaction, so
   * a failure MUST propagate and roll the upload back. Otherwise a document
   * could be stored with no decision row, which is precisely the hole this
   * table exists to close.
   */
  it('throws from the transactional variant so the caller rolls back', async () => {
    const tx = { phiDecision: { create: vi.fn().mockRejectedValue(new Error('db down')) } };

    await expect(
      recordPhiDecisionInTransaction(tx as never, {
        source: 'document_upload',
        scan: cleanScan,
        scannedText: DOC_TEXT,
        documentVersionId: 'ver-1',
      }),
    ).rejects.toThrow('db down');
  });

  it('links the accepted row to its document version', async () => {
    const tx = { phiDecision: { create: vi.fn().mockResolvedValue({}) } };

    await recordPhiDecisionInTransaction(tx as never, {
      source: 'document_upload',
      scan: cleanScan,
      scannedText: DOC_TEXT,
      documentVersionId: 'ver-1',
    });

    const { data } = tx.phiDecision.create.mock.calls[0][0];
    expect(data.documentVersionId).toBe('ver-1');
    expect(data.outcome).toBe('allowed');
  });
});
