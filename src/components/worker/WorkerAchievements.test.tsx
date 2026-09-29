/**
 * BUG-41: the headline and the "+N more" footer used to read the completed-course
 * count, so they could disagree with the certificates actually listed. The
 * footer's plural (`count - 4 !== 0`) was equivalent to `more !== 1`, just
 * opaque; these pin the singular/plural boundary now it reads `more` directly.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import WorkerAchievements from './WorkerAchievements';

function certs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cert-${i}`,
    courseTitle: `Course ${i}`,
    issuedAt: new Date('2026-09-10T00:00:00Z'),
  }));
}

describe('WorkerAchievements', () => {
  it('states the certificate count it is given', () => {
    render(<WorkerAchievements certificateCount={2} recentCertificates={certs(2)} />);

    expect(screen.getByText('2 certificates')).toBeInTheDocument();
    expect(screen.queryByText(/more certificate/)).not.toBeInTheDocument();
  });

  it('uses the singular for one certificate', () => {
    render(<WorkerAchievements certificateCount={1} recentCertificates={certs(1)} />);

    expect(screen.getByText('1 certificate')).toBeInTheDocument();
  });

  it('says "+1 more certificate" (singular) with four certificates and three shown', () => {
    render(<WorkerAchievements certificateCount={4} recentCertificates={certs(3)} />);

    expect(
      screen.getByRole('link', { name: /\+1 more certificate — see all/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/more certificates/)).not.toBeInTheDocument();
  });

  it('says "+2 more certificates" (plural) with five certificates and three shown', () => {
    render(<WorkerAchievements certificateCount={5} recentCertificates={certs(3)} />);

    expect(
      screen.getByRole('link', { name: /\+2 more certificates — see all/ }),
    ).toBeInTheDocument();
  });

  it('shows the empty state, with no "View all" link, when there are no certificates', () => {
    render(<WorkerAchievements certificateCount={0} recentCertificates={[]} />);

    expect(screen.getByText('0 certificates')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View all certificates/ })).not.toBeInTheDocument();
  });
});
