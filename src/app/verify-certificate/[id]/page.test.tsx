/**
 * F-038 regression test for the public /verify-certificate/[id] page.
 *
 * Bug: the recipient's raw email address was used as a fallback display value
 * (`certificate.user.profile?.fullName || certificate.user.email`) on a page
 * that is intentionally reachable WITHOUT authentication (anyone scanning the
 * certificate's QR code lands here). Fixed to fall back to a generic
 * "Certificate holder" label, and the Prisma `select` no longer even fetches
 * the user's email field.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { certificate: { findUnique: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import VerifyCertificatePage from './page';

const CERT_ID = 'cert-1';
const RECIPIENT_EMAIL = 'jane.doe.recipient@example.com';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VerifyCertificatePage — no email fallback/selection (F-038)', () => {
  it('falls back to a generic label, never the email, when the profile has no full name', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      issuedAt: new Date('2026-01-15'),
      course: { title: 'Fire Safety' },
      user: {
        profile: { fullName: null },
        organization: { name: 'Acme Co' },
        // Note: a real DB response (per the fixed `select`) would never even
        // include `email` here — this mock proves the page doesn't rely on
        // it being absent, i.e. it never *reads* certificate.user.email even
        // when present, only certificate.user.profile?.fullName.
      },
    });

    const element = await VerifyCertificatePage({ params: Promise.resolve({ id: CERT_ID }) });
    render(element);

    expect(screen.getByText('Certificate holder')).toBeInTheDocument();
    expect(screen.queryByText(RECIPIENT_EMAIL)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RECIPIENT_EMAIL);
  });

  it('renders the full name when present, and the query never selects email', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      issuedAt: new Date('2026-01-15'),
      course: { title: 'Fire Safety' },
      user: {
        profile: { fullName: 'Jane Doe' },
        organization: { name: 'Acme Co' },
      },
    });

    const element = await VerifyCertificatePage({ params: Promise.resolve({ id: CERT_ID }) });
    render(element);

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();

    const call = prismaMock.certificate.findUnique.mock.calls[0][0];
    expect(call.select.user.select).not.toHaveProperty('email');
  });

  it('renders the not-found state without touching user data when no certificate matches', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue(null);

    const element = await VerifyCertificatePage({ params: Promise.resolve({ id: 'unknown' }) });
    render(element);

    expect(screen.getByText('Certificate Not Found')).toBeInTheDocument();
  });
});
