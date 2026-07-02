import { describe, it, expect } from 'vitest';
import { formatCertificateId } from './certificate-id';

describe('formatCertificateId', () => {
  it('formats a cuid-style enrollment id as CERT-<first 8 chars, uppercased>', () => {
    expect(formatCertificateId('clx1a2b3c4d5e6f7g8h9')).toBe('CERT-CLX1A2B3');
  });

  it('uppercases lowercase alphanumeric ids', () => {
    expect(formatCertificateId('abcdefgh')).toBe('CERT-ABCDEFGH');
  });

  it('is deterministic — the same enrollment id always yields the same certificate id', () => {
    const id = 'stableid1234567890';
    expect(formatCertificateId(id)).toBe(formatCertificateId(id));
  });

  it('produces DIFFERENT ids for enrollments that differ within the first 8 characters', () => {
    expect(formatCertificateId('aaa11111-rest')).not.toBe(formatCertificateId('bbb22222-rest'));
  });

  it('handles an id shorter than 8 characters without throwing', () => {
    expect(formatCertificateId('ab12')).toBe('CERT-AB12');
  });
});
