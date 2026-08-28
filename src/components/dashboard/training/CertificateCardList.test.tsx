/**
 * Pins the illustrated empty state (7377c4f2) that replaced the bare
 * EmptyTableState, and the export-controls gating from #6 — both conditions
 * now live in the same component and must be verified independently so a
 * regression in one cannot hide behind the other.
 *
 * #6: the date-range Select and Export button used to render even for an org
 * with zero certificates, offering an export with nothing to export. They now
 * require `certificates.length > 0` AND `showExport`. The <h1> and description
 * stay unconditional — this component is both page chrome and card.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

vi.mock('./CertificateModal', () => ({
  default: () => null,
}));

import CertificateCardList from './CertificateCardList';

function certificate(overrides: Partial<{ id: string; enrollmentId: string }> = {}) {
  return {
    id: 'cert-1',
    enrollmentId: 'enrollment-12345678',
    course: { title: 'Bloodborne Pathogens' },
    issuedAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

describe('CertificateCardList — empty state', () => {
  it('renders the illustrated empty state with heading, body copy, and a working CTA link', () => {
    render(<CertificateCardList certificates={[]} />);

    // alt="" + aria-hidden gives this element accessibility role "presentation",
    // not "img" — query by alt text instead of role.
    const illustration = screen.getByAltText('');
    expect(illustration).toHaveAttribute('src', '/images/certificates-empty-state.svg');
    expect(illustration).toHaveAttribute('alt', '');
    expect(illustration).toHaveAttribute('aria-hidden', 'true');

    expect(screen.getByText('No certificate earned yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Complete a course to earn your certificate — once you do, it will appear here.',
      ),
    ).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: 'Browse trainings' });
    expect(cta).toHaveAttribute('href', '/worker/trainings');
  });

  it('does not render the old plain empty-state copy', () => {
    render(<CertificateCardList certificates={[]} />);

    expect(screen.queryByText('No certificates available.')).not.toBeInTheDocument();
  });

  it('the CTA is a real link reachable by keyboard, not a button-shaped div', () => {
    render(<CertificateCardList certificates={[]} />);

    const cta = screen.getByRole('link', { name: 'Browse trainings' });
    expect(cta.tagName).toBe('A');
    expect(cta).not.toHaveAttribute('role', 'button');
    expect(cta).toHaveAccessibleName('Browse trainings');
    // A native <a href> is in the tab order without an explicit tabIndex.
    expect(cta).not.toHaveAttribute('tabindex', '-1');
  });

  it('still renders the title and description props above the empty state', () => {
    render(
      <CertificateCardList
        certificates={[]}
        title="My Certificates"
        description="Certificates you have earned will be displayed here"
      />,
    );

    expect(screen.getByRole('heading', { name: 'My Certificates' })).toBeInTheDocument();
    expect(
      screen.getByText('Certificates you have earned will be displayed here'),
    ).toBeInTheDocument();
  });
});

describe('CertificateCardList — populated state', () => {
  it('renders the certificate list instead of the empty-state illustration, heading, or CTA', () => {
    render(<CertificateCardList certificates={[certificate()]} />);

    expect(screen.queryByAltText('')).not.toBeInTheDocument();
    expect(screen.queryByText('No certificate earned yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse trainings' })).not.toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'View certificate for Bloodborne Pathogens' }),
    ).toBeInTheDocument();
  });
});

describe('CertificateCardList — export controls gating', () => {
  it('hides the date-range filter and Export button when there are no certificates, but still renders the heading and description', () => {
    render(
      <CertificateCardList
        certificates={[]}
        title="Certificates"
        description="Here's a quick summary of your earned certificates."
      />,
    );

    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(
      screen.getByText("Here's a quick summary of your earned certificates."),
    ).toBeInTheDocument();
  });

  it('stays gated with zero certificates even when showExport is explicitly true', () => {
    render(<CertificateCardList certificates={[]} showExport={true} />);

    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
  });

  it('shows the date-range filter and Export button once at least one certificate exists', () => {
    render(<CertificateCardList certificates={[certificate()]} />);

    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('respects showExport={false} independently of certificate count', () => {
    render(<CertificateCardList certificates={[certificate()]} showExport={false} />);

    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    // The certificate list itself is unaffected by showExport.
    expect(
      screen.getByRole('button', { name: 'View certificate for Bloodborne Pathogens' }),
    ).toBeInTheDocument();
  });
});
