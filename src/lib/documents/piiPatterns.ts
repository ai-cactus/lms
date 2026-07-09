/**
 * Deterministic PII pattern library used as a local pre-pass before the
 * BAA-covered Vertex AI PHI scan.
 *
 * The goal is defence-in-depth and data minimisation: obvious structural
 * identifiers (SSN, email, phone) can be detected locally with high confidence,
 * letting us fail-closed WITHOUT ever transmitting the document to an external
 * model. Softer, context-dependent categories (a bare US ZIP, an MRN-like
 * token) are ambiguous on their own — a 5-digit number is usually not PHI — so
 * they are surfaced for observability but deferred to the contextual Vertex
 * scan rather than triggering a local block.
 *
 * NOTE: these regexes only catch *structural* identifiers. Fully eliminating
 * pre-verification transmission of free-text identifiers such as patient names
 * and street addresses would require a real local NER/DLP model, which is a
 * recommended follow-up.
 */

export type PiiCategory = 'SSN' | 'EMAIL' | 'PHONE' | 'ZIP' | 'MRN';

/**
 * 'high'  — structural identifier we trust locally; fail-closed with zero AI transmission.
 * 'soft'  — ambiguous on its own; defer to the contextual Vertex scan.
 */
export type PiiConfidence = 'high' | 'soft';

export interface PiiPatternMatch {
  category: PiiCategory;
  confidence: PiiConfidence;
  /** The exact matched substring. Used transiently for offsets/logging — never persisted. */
  value: string;
  /** Character offset of the match within the scanned text. */
  index: number;
}

interface PiiPatternDef {
  category: PiiCategory;
  confidence: PiiConfidence;
  pattern: RegExp;
}

/**
 * Pattern definitions. Kept intentionally conservative for the high-confidence
 * tier: a false positive there blocks a legitimate upload, so we require the
 * canonical dashed/formatted shapes rather than any loose digit run.
 */
const PII_PATTERNS: readonly PiiPatternDef[] = [
  // SSN — canonical dashed form only (123-45-6789) to minimise false positives.
  { category: 'SSN', confidence: 'high', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },

  // Email address.
  {
    category: 'EMAIL',
    confidence: 'high',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },

  // US phone number — requires separators/parentheses so bare 10-digit runs
  // (e.g. IDs) don't match. Handles optional +1 country code.
  {
    category: 'PHONE',
    confidence: 'high',
    pattern: /\b(?:\+?1[-.\s])?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g,
  },

  // US ZIP / ZIP+4 — extremely common; ambiguous without context.
  { category: 'ZIP', confidence: 'soft', pattern: /\b\d{5}(?:-\d{4})?\b/g },

  // MRN-like — a labelled medical-record token (e.g. "MRN: 12345").
  {
    category: 'MRN',
    confidence: 'soft',
    pattern: /\b(?:MRN|Medical Record(?:\s+Number)?)\s*[:#]?\s*\d{4,}\b/gi,
  },
];

/**
 * Scan text for all known PII patterns.
 *
 * Returns every match with its category, confidence tier, matched value and
 * character offset. A fresh RegExp instance is created per scan so the module's
 * global (`/g`) patterns never leak `lastIndex` state across calls.
 */
export function scanForPii(text: string): PiiPatternMatch[] {
  const matches: PiiPatternMatch[] = [];

  for (const { category, confidence, pattern } of PII_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ category, confidence, value: m[0], index: m.index });
      // Guard against zero-length matches causing an infinite loop.
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  return matches;
}

/**
 * Convenience filter: the high-confidence structural identifiers that justify a
 * local fail-closed decision (SSN, email, phone) with zero AI transmission.
 */
export function scanForHighConfidencePii(text: string): PiiPatternMatch[] {
  return scanForPii(text).filter((m) => m.confidence === 'high');
}
