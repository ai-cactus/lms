/**
 * Recording of PHI-scan decisions to the append-only `phi_decisions` ledger
 * (F-092).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `PhiReport` hangs off `documentVersionId`, and a blocked upload never gets a
 * DocumentVersion — the upload paths return before storage. So PhiReport can
 * only ever evidence what was ACCEPTED. Rejections, which are what matter when
 * someone alleges PHI entered the system, previously left no durable trace
 * beyond a `logger.warn` to stdout.
 *
 * This ledger records EVERY decision — allowed, blocked for PHI, and blocked
 * because the scan could not complete — so the question "prove you rejected it"
 * has an answer in SQL rather than in a rotated container log.
 *
 * ── Durability contract ─────────────────────────────────────────────────────
 * Deliberately NOT modelled on `audit()`, which swallows every error by design
 * (see the contract in src/lib/audit.ts). The two paths differ:
 *
 *   ALLOWED  — pass the surrounding transaction as `client`. The decision row
 *              and the DocumentVersion then commit or roll back together, so
 *              there can be no accepted document without a decision row. A
 *              write failure correctly fails the upload.
 *
 *   BLOCKED  — no transaction exists (the caller is about to return an error),
 *              so this writes standalone and catches. The user stays blocked
 *              either way; turning a clear "PHI detected" message into a
 *              generic failure would cost UX for no security gain. A failure
 *              here is logged at error level because it means the ledger has a
 *              hole.
 */

import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Prisma } from '@/generated/prisma/client';
import type { ScanResult, PHIDecidedBy } from '@/lib/documents/phiScanner';

/**
 * Where the scanned text entered the system. A string discriminator rather than
 * a relation, so a new ingress point (e.g. lesson-editor text — F-089) can be
 * recorded without a migration.
 */
export type PhiDecisionSource =
  | 'document_upload'
  | 'course_wizard_upload'
  /** Lesson body text typed or pasted into the authoring UI (F-089). */
  | 'lesson_edit'
  /** Free-text context supplied by the client to AI quiz generation (F-089). */
  | 'quiz_context';

export type PhiDecisionOutcome = 'allowed' | 'blocked_phi' | 'blocked_scan_failed';

/** Minimal Prisma client surface, so a transaction client can be passed in. */
type PrismaLike = Pick<Prisma.TransactionClient, 'phiDecision'>;

export interface PhiDecisionInput {
  source: PhiDecisionSource;
  scan: ScanResult;
  /** The text that was scanned. Hashed only — never stored. */
  scannedText: string;
  /** Hashed only: a filename can itself carry PHI ("john-doe-intake.pdf"). */
  filename?: string;
  /** Present only for accepted content, where a version row exists. */
  documentVersionId?: string;
  actorId?: string;
  organizationId?: string;
}

/** Maps a scan result to a ledger outcome. Order matters: a failed scan is not a detection. */
export function outcomeFromScan(scan: ScanResult): PhiDecisionOutcome {
  if (scan.scanFailed) return 'blocked_scan_failed';
  return scan.hasPHI ? 'blocked_phi' : 'allowed';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Distinct finding types, e.g. ['SSN','EMAIL']. Types only — never values. */
function findingTypes(scan: ScanResult): string[] {
  return [...new Set(scan.findings.map((f) => f.type))].sort();
}

/**
 * Bumped whenever detection behaviour changes, so the ledger stays interpretable
 * after the scanner evolves — a run of "allowed" rows means little if you cannot
 * tell which detector produced them.
 */
export const DETECTOR_VERSION = 'v2';

function toRow(input: PhiDecisionInput) {
  const { scan } = input;
  return {
    source: input.source,
    outcome: outcomeFromScan(scan),
    decidedBy: (scan.decidedBy ?? null) as PHIDecidedBy | null,
    documentVersionId: input.documentVersionId ?? null,
    detectorVersion: DETECTOR_VERSION,
    findingTypes: findingTypes(scan),
    findingCount: scan.findings.length,
    // Value-free shape: { type, offsetStart, offsetEnd, confidence }.
    entities: scan.findings as unknown as Prisma.InputJsonValue,
    contentHash: sha256Hex(input.scannedText),
    contentLength: input.scannedText.length,
    filenameHash: input.filename ? sha256Hex(input.filename) : null,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
  };
}

/**
 * Records a decision inside the caller's transaction. THROWS on failure, which
 * rolls the caller back — use this on the accepted path so an accepted document
 * and its decision row are atomic.
 */
export async function recordPhiDecisionInTransaction(
  client: PrismaLike,
  input: PhiDecisionInput,
): Promise<void> {
  await client.phiDecision.create({ data: toRow(input) });
}

/**
 * Records a decision standalone, catching and logging failures. Use on the
 * blocked paths, where the caller is about to return an error and there is no
 * transaction to join.
 */
export async function recordPhiDecision(input: PhiDecisionInput): Promise<void> {
  try {
    await prisma.phiDecision.create({ data: toRow(input) });
  } catch (err) {
    // The ledger now has a hole. Loud, because the whole point of this table is
    // being able to prove what happened.
    logger.error({
      msg: '[phi] FAILED to record PHI decision — evidence ledger has a gap',
      err,
      source: input.source,
      outcome: outcomeFromScan(input.scan),
      actorId: input.actorId,
    });
  }
}
