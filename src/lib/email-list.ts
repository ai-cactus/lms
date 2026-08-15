/**
 * Shared parsing for the free-text "paste a list of emails" inputs (staff
 * invites, course assignment). Kept separate from the spreadsheet parser in
 * `staff-csv.ts` so both entry points validate addresses identically — a
 * divergence here would let an email be accepted by one flow and rejected by
 * the other.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

export interface ParsedEmailList {
  /** Unique, lowercased, valid addresses in first-seen order. */
  valid: string[];
  /** Tokens that failed validation (duplicates are not counted as invalid). */
  invalidCount: number;
}

/**
 * Split free text on commas, whitespace, semicolons or new lines and partition
 * the tokens into valid (deduplicated, lowercased) and invalid.
 */
export function parseEmailList(text: string): ParsedEmailList {
  const tokens = text
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;

  for (const token of tokens) {
    if (!isValidEmail(token)) {
      invalidCount++;
      continue;
    }
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    valid.push(lower);
  }

  return { valid, invalidCount };
}
