/**
 * The flattener is the definition of "what the download will contain", shared
 * by the download route (which serialises these rows) and the export worker
 * (which counts them so the banner can distinguish an empty export).
 *
 * The first test pins the mechanism the whole fix rests on: a result with no
 * rows becomes a ZERO-BYTE CSV, served 200 with an attachment filename — a
 * success the user cannot tell apart from a download that never happened.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { flattenAuditReport } from './flatten';
import type { AuditReportResult } from './types';

function csvFor(result: AuditReportResult): string {
  return XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(flattenAuditReport(result)));
}

const BASE = { generatedAt: '2026-09-17T00:00:00.000Z', orgName: 'Acme Health' };

describe('flattenAuditReport', () => {
  it('serialises a row-less result to an empty CSV', () => {
    const result = {
      ...BASE,
      scope: 'staff',
      staff: { name: 'Dana Reed', roleLabel: 'Nurse', email: 'dana@example.com' },
      transcript: [],
    } as AuditReportResult;

    expect(flattenAuditReport(result)).toEqual([]);
    expect(csvFor(result)).toBe('');
  });

  it('produces one row per transcript entry for a staff report', () => {
    const result = {
      ...BASE,
      scope: 'staff',
      staff: { name: 'Dana Reed', roleLabel: 'Nurse', email: 'dana@example.com' },
      transcript: [
        {
          courseTitle: 'Bloodborne Pathogens',
          type: 'text',
          category: 'Compliance',
          status: 'completed',
          score: 90,
          attempts: 1,
          dateAssigned: '2026-01-01',
          dateCompleted: '2026-01-05',
        },
      ],
    } as unknown as AuditReportResult;

    expect(flattenAuditReport(result)).toHaveLength(1);
    expect(csvFor(result)).toContain('Bloodborne Pathogens');
  });

  it('counts the catalogue, not the enrollments, for an all-courses report', () => {
    // An org-wide course export over a quiet date range still has rows: the
    // catalogue is not date-filtered, only the activity inside it is. Counting
    // enrollments here would suppress a report that does have content.
    const result = {
      ...BASE,
      scope: 'all-courses',
      summary: { totalCourses: 2, totalStaff: 0, completionRate: 0 },
      courses: [
        {
          courseTitle: 'Bloodborne Pathogens',
          category: 'Compliance',
          type: 'text',
          status: 'published',
          assignedStaff: 0,
          completed: 0,
          completionRate: 0,
        },
        {
          courseTitle: 'Confidentiality',
          category: 'Compliance',
          type: 'text',
          status: 'inactive',
          assignedStaff: 0,
          completed: 0,
          completionRate: 0,
        },
      ],
    } as unknown as AuditReportResult;

    expect(flattenAuditReport(result)).toHaveLength(2);
  });
});
