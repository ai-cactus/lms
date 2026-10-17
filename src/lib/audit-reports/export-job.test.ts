import { describe, it, expect } from 'vitest';
import { AUDITOR_EXPORT_JOB_TYPE, exportJobOrganizationId } from './export-job';

describe('exportJobOrganizationId', () => {
  it('reads the stamped organization', () => {
    expect(exportJobOrganizationId({ organizationId: 'org-1', progress: 100 })).toBe('org-1');
  });

  it.each([
    ['null payload', null],
    ['empty object', {}],
    ['array payload', ['org-1']],
    ['number payload', 42],
    ['string payload', 'org-1'],
    ['numeric organizationId', { organizationId: 7 }],
    ['null organizationId', { organizationId: null }],
    ['object organizationId', { organizationId: { id: 'org-1' } }],
  ])('treats %s as unstamped', (_label, payload) => {
    expect(exportJobOrganizationId(payload as never)).toBeUndefined();
  });

  it('matches the job type the worker queue writes', () => {
    expect(AUDITOR_EXPORT_JOB_TYPE).toBe('AUDITOR_PACK_EXPORT');
  });
});
