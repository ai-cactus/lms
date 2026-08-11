/**
 * The single gate for user-authored text (F-089).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The PHI scan originally covered ONE ingress: uploaded documents. Text typed or
 * pasted straight into the app — lesson bodies in the authoring UI, free-text
 * context handed to AI quiz generation — reached storage and Vertex AI without
 * passing any gate at all. So the product could truthfully say "we scan uploaded
 * documents" while an admin pasting a discharge summary into a lesson was
 * completely unchecked.
 *
 * "PHI is fully blocked" requires every ingress to go through the same gate, and
 * every decision to land in the same ledger. This wraps scan + record + reject so
 * a new ingress point is one call rather than a re-implementation, and so no call
 * site can accidentally scan without recording.
 *
 * ── Cost, stated plainly ────────────────────────────────────────────────────
 * The deterministic local pass is free and runs on every input. The contextual AI
 * pass costs a Vertex round trip, so saving a long lesson is now slower. That is
 * the accepted trade for closing the gap; it is not free, and pretending
 * otherwise would be the wrong kind of reassurance.
 */

import { scanText } from '@/lib/documents/phiScanner';
import { recordPhiDecision, type PhiDecisionSource } from '@/lib/documents/phiDecision';
import { logger } from '@/lib/logger';

/**
 * Thrown when content is rejected. Carries a user-safe message: callers should
 * surface `message` directly and must not add detail of their own, since the
 * findings deliberately contain no values to report.
 */
export class PhiBlockedError extends Error {
  readonly phiDetected = true;
  constructor(message: string) {
    super(message);
    this.name = 'PhiBlockedError';
  }
}

const PHI_DETECTED_MESSAGE =
  'This content appears to contain PHI (e.g. a name, SSN, date of birth, phone number or email address) and cannot be saved. Remove the personal details and try again.';

const SCAN_FAILED_MESSAGE =
  'We could not verify this content for PHI right now. Please try again in a moment.';

export interface PhiGateInput {
  text: string;
  source: PhiDecisionSource;
  actorId?: string;
  organizationId?: string;
  /** Extra context for the log line only — never persisted. */
  logContext?: Record<string, unknown>;
}

/**
 * Scans user-authored text, records the decision, and THROWS if it must not be
 * stored.
 *
 * Fails closed: a scan that cannot complete rejects the content rather than
 * letting it through, matching `uploadDocument`. The distinction between "PHI
 * found" and "could not verify" is preserved in the message so the user knows
 * whether to edit or retry.
 *
 * @throws {PhiBlockedError}
 */
export async function assertNoPhi(input: PhiGateInput): Promise<void> {
  // Nothing to scan. Note this is a genuinely empty string, not "short" — short
  // text still goes through the local pass (see scanText).
  if (!input.text || input.text.trim().length === 0) return;

  const scan = await scanText(input.text);

  await recordPhiDecision({
    source: input.source,
    scan,
    scannedText: input.text,
    actorId: input.actorId,
    organizationId: input.organizationId,
  });

  if (scan.scanFailed) {
    logger.warn({
      msg: '[phi] Content blocked — scan could not complete',
      source: input.source,
      actorId: input.actorId,
      ...input.logContext,
    });
    throw new PhiBlockedError(SCAN_FAILED_MESSAGE);
  }

  if (scan.hasPHI) {
    logger.warn({
      msg: '[phi] Content blocked — PHI detected',
      source: input.source,
      actorId: input.actorId,
      decidedBy: scan.decidedBy,
      // Types only. The values are exactly what must not be logged.
      findingTypes: [...new Set(scan.findings.map((f) => f.type))],
      ...input.logContext,
    });
    throw new PhiBlockedError(PHI_DETECTED_MESSAGE);
  }
}
