/**
 * Tests for the user-authored-text PHI gate (F-089).
 *
 * The scan originally covered ONE ingress: uploaded documents. Lesson bodies typed
 * into the authoring UI and free-text context handed to AI quiz generation reached
 * storage and Vertex AI ungated — so the product could truthfully claim "we scan
 * uploaded documents" while a pasted discharge summary was never checked.
 *
 * Every case here asserts BOTH halves: the content is rejected, AND the decision
 * is recorded. A gate that blocks without recording leaves no evidence, which is
 * the whole point of the ledger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockScanText, mockRecordPhiDecision, mockLogger } = vi.hoisted(() => ({
  mockScanText: vi.fn(),
  mockRecordPhiDecision: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/documents/phiScanner', () => ({ scanText: mockScanText }));
vi.mock('@/lib/documents/phiDecision', () => ({ recordPhiDecision: mockRecordPhiDecision }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { assertNoPhi, PhiBlockedError } from './phiGate';

const CLEAN = { hasPHI: false, findings: [], decidedBy: 'ai' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockScanText.mockResolvedValue(CLEAN);
});

describe('assertNoPhi — clean content', () => {
  it('resolves and records the allowed decision', async () => {
    await expect(
      assertNoPhi({ text: 'Escalate within 72 hours.', source: 'lesson_edit', actorId: 'u1' }),
    ).resolves.toBeUndefined();

    expect(mockRecordPhiDecision).toHaveBeenCalledTimes(1);
    expect(mockRecordPhiDecision.mock.calls[0][0]).toMatchObject({
      source: 'lesson_edit',
      actorId: 'u1',
    });
  });

  // A title-only lesson edit passes content: '' — no reason to spend a Vertex
  // round trip on nothing.
  it('no-ops on empty or whitespace input without scanning', async () => {
    await assertNoPhi({ text: '', source: 'lesson_edit' });
    await assertNoPhi({ text: '   \n  ', source: 'lesson_edit' });

    expect(mockScanText).not.toHaveBeenCalled();
    expect(mockRecordPhiDecision).not.toHaveBeenCalled();
  });
});

describe('assertNoPhi — PHI detected', () => {
  beforeEach(() => {
    mockScanText.mockResolvedValue({
      hasPHI: true,
      decidedBy: 'local_regex',
      findings: [{ type: 'SSN', offsetStart: 4, offsetEnd: 15, confidence: 1 }],
    });
  });

  it('throws a PhiBlockedError with actionable guidance', async () => {
    await expect(assertNoPhi({ text: 'SSN 123-45-6789', source: 'lesson_edit' })).rejects.toThrow(
      PhiBlockedError,
    );

    await expect(assertNoPhi({ text: 'SSN 123-45-6789', source: 'lesson_edit' })).rejects.toThrow(
      /cannot be saved/,
    );
  });

  it('records the rejection — a block without evidence is not enough', async () => {
    await expect(
      assertNoPhi({ text: 'SSN 123-45-6789', source: 'lesson_edit', actorId: 'u1' }),
    ).rejects.toThrow();

    expect(mockRecordPhiDecision).toHaveBeenCalledTimes(1);
  });

  it('logs finding TYPES but never the detected value', async () => {
    await expect(assertNoPhi({ text: 'SSN 123-45-6789', source: 'lesson_edit' })).rejects.toThrow();

    const payload = mockLogger.warn.mock.calls.at(-1)?.[0];
    expect(payload.findingTypes).toEqual(['SSN']);
    expect(JSON.stringify(payload)).not.toContain('123-45-6789');
  });
});

describe('assertNoPhi — fails closed', () => {
  /**
   * A scan that cannot complete must reject, matching uploadDocument. Letting
   * content through because the scanner was unavailable would make the gate
   * useless in exactly the moment it is needed.
   */
  it('rejects when the scan could not complete, with a distinct retryable message', async () => {
    mockScanText.mockResolvedValue({
      hasPHI: true,
      scanFailed: true,
      findings: [],
      decidedBy: 'ai',
    });

    await expect(assertNoPhi({ text: 'a'.repeat(80), source: 'lesson_edit' })).rejects.toThrow(
      /could not verify/,
    );
    // Distinct from the detection message so the user knows to retry, not edit.
    await expect(assertNoPhi({ text: 'a'.repeat(80), source: 'lesson_edit' })).rejects.not.toThrow(
      /cannot be saved/,
    );
  });

  it('still records a decision when the scan fails', async () => {
    mockScanText.mockResolvedValue({
      hasPHI: true,
      scanFailed: true,
      findings: [],
      decidedBy: 'ai',
    });

    await expect(assertNoPhi({ text: 'a'.repeat(80), source: 'quiz_context' })).rejects.toThrow();

    expect(mockRecordPhiDecision).toHaveBeenCalledTimes(1);
  });
});
