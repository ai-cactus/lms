import { describe, expect, it } from 'vitest';
import { ALLOWLIST, evaluateAudit } from './audit-allowlist.mjs';

const advisory = (name: string, severity: string, ghsa: string) => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
  range: '*',
});

describe('evaluateAudit', () => {
  it('accepts an allowlisted high advisory and the packages that only chain to it', () => {
    const report = {
      vulnerabilities: {
        braces: { via: [advisory('braces', 'high', 'GHSA-vfj7-8cjw-p6xm')] },
        micromatch: { via: ['braces'] },
        'eslint-config-next': { via: ['@next/eslint-plugin-next'] },
      },
    };
    expect(evaluateAudit(report)).toEqual({ blocking: [], accepted: ['GHSA-vfj7-8cjw-p6xm'] });
  });

  it('blocks a high or critical advisory that is not allowlisted', () => {
    const report = {
      vulnerabilities: {
        braces: { via: [advisory('braces', 'high', 'GHSA-vfj7-8cjw-p6xm')] },
        next: { via: [advisory('next', 'critical', 'GHSA-aaaa-bbbb-cccc')] },
      },
    };
    const { blocking } = evaluateAudit(report);
    expect(blocking).toEqual([
      { id: 'GHSA-aaaa-bbbb-cccc', name: 'next', severity: 'critical', title: 'next advisory' },
    ]);
  });

  it('ignores moderate and low advisories, matching --audit-level=high', () => {
    const report = {
      vulnerabilities: {
        'stream-json': { via: [advisory('stream-json', 'moderate', 'GHSA-528h-pc64-c93x')] },
        foo: { via: [advisory('foo', 'low', 'GHSA-1111-2222-3333')] },
      },
    };
    expect(evaluateAudit(report).blocking).toEqual([]);
  });

  it('reports a blocking advisory once even when several packages carry it', () => {
    const a = advisory('next', 'high', 'GHSA-aaaa-bbbb-cccc');
    const report = { vulnerabilities: { next: { via: [a] }, other: { via: [a] } } };
    expect(evaluateAudit(report).blocking).toHaveLength(1);
  });

  it('rejects input that is not an audit report, such as a registry error', () => {
    expect(() => evaluateAudit({ error: { code: 'ENOTFOUND' } })).toThrow();
    expect(() => evaluateAudit(null)).toThrow();
  });

  it('documents every allowlist entry', () => {
    for (const [id, reason] of Object.entries(ALLOWLIST)) {
      expect(id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
