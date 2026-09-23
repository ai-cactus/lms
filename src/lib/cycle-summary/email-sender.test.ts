/**
 * Unit tests for src/lib/cycle-summary/email-sender.ts
 *
 * Covers: the period-key → date-label conversion that produces the fixed
 * subject; the domain → template section mapping for all three shapes; the
 * transport result being threaded back; and the sender never throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendCycleSummaryEmail } = vi.hoisted(() => ({
  mockSendCycleSummaryEmail: vi.fn(),
}));

vi.mock('@/lib/email', () => ({ sendCycleSummaryEmail: mockSendCycleSummaryEmail }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { cycleSummaryEmailSender, summaryDateLabel } from './email-sender';
import type { CycleSummaryMessage } from './compose';

function message(overrides: Partial<CycleSummaryMessage> = {}): CycleSummaryMessage {
  return {
    to: 'worker@acme.com',
    toName: 'Dana Learner',
    organizationName: 'Acme Care',
    periodKey: 'daily:2026-09-23',
    itemCount: 1,
    sections: [
      {
        id: 'training_due',
        title: 'Your training — overdue and due today',
        items: [
          { courseTitle: 'Bloodborne Pathogens', detail: 'Due today', dueAt: null, daysOverdue: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendCycleSummaryEmail.mockResolvedValue({ success: true, messageId: 'mid-1' });
});

describe('summaryDateLabel', () => {
  it('renders a daily period key as a friendly date', () => {
    expect(summaryDateLabel('daily:2026-09-23')).toBe('September 23, 2026');
  });

  it('drops the leading zero from the day', () => {
    expect(summaryDateLabel('daily:2026-03-01')).toBe('March 1, 2026');
  });

  it('degrades to the raw value for an unexpected key shape', () => {
    expect(summaryDateLabel('weekly:2026-W32')).toBe('2026-W32');
  });
});

describe('cycleSummaryEmailSender', () => {
  it('passes the recipient, org and date label through to the template', async () => {
    await cycleSummaryEmailSender(message());

    expect(mockSendCycleSummaryEmail).toHaveBeenCalledWith(
      'worker@acme.com',
      'Dana Learner',
      expect.objectContaining({ organizationName: 'Acme Care', dateLabel: 'September 23, 2026' }),
    );
  });

  it('maps each domain section shape onto its template counterpart', async () => {
    await cycleSummaryEmailSender(
      message({
        sections: [
          {
            id: 'training_upcoming',
            title: 'Your training — upcoming',
            items: [
              {
                courseTitle: 'Fire Safety',
                detail: 'Due October 1, 2026',
                dueAt: null,
                daysOverdue: 0,
              },
            ],
          },
          {
            id: 'team_compliance',
            title: 'Team & compliance',
            groups: [
              {
                workerName: 'Sam Report',
                items: [
                  { courseTitle: 'HIPAA', detail: '7 days overdue', dueAt: null, daysOverdue: 7 },
                ],
              },
            ],
          },
          {
            id: 'organization_updates',
            title: 'Organization updates',
            sections: [
              {
                facilityName: 'Organization-wide',
                groups: [
                  {
                    type: 'STAFF_ADDED',
                    label: 'Staff added',
                    items: [
                      {
                        title: 'New staff member added',
                        message: 'Jane joined as Nurse.',
                        occurredAt: new Date('2026-09-23T10:00:00.000Z'),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const [, , content] = mockSendCycleSummaryEmail.mock.calls[0];
    expect(content.sections.map((s: { kind: string }) => s.kind)).toEqual([
      'training',
      'team',
      'updates',
    ]);
    expect(content.sections[0].items).toEqual([
      { courseTitle: 'Fire Safety', detail: 'Due October 1, 2026' },
    ]);
    expect(content.sections[1].groups[0].workerName).toBe('Sam Report');
    expect(content.sections[2].sections[0].facilityName).toBe('Organization-wide');
  });

  it('threads a transport failure back instead of throwing', async () => {
    mockSendCycleSummaryEmail.mockResolvedValue({ success: false, error: 'SMTP down' });

    await expect(cycleSummaryEmailSender(message())).resolves.toEqual({
      ok: false,
      error: 'SMTP down',
    });
  });

  it('never throws when the template itself throws', async () => {
    mockSendCycleSummaryEmail.mockRejectedValue(new Error('boom'));

    const result = await cycleSummaryEmailSender(message());

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});
