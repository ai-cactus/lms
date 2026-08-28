/**
 * Tests for CertificateCardList's export-controls gating (#6): the date-range
 * Select and Export button used to render even for an org with zero
 * certificates, offering an export with nothing to export. They now render
 * only when `certificates.length > 0`, independently of `showExport` — the
 * page's <h1> and description stay unconditional since this component is
 * both page chrome and card.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('./CertificateModal', () => ({
  default: () => null,
}));

import CertificateCardList from './CertificateCardList';

const CERT = {
  id: 'cert-1',
  enrollmentId: 'enr-1',
  course: { title: 'Infection Control' },
  issuedAt: '2026-01-15T12:00:00.000Z',
};

describe('CertificateCardList — no certificates (#6)', () => {
  it('renders the heading and description but no date-range Select or Export button', () => {
    render(<CertificateCardList certificates={[]} />);

    expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(
      screen.getByText("Here's a quick summary of your earned certificates."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
    expect(screen.getByText('No certificates available.')).toBeInTheDocument();
  });

  it('keeps rendering a custom title and description with zero certificates', () => {
    render(
      <CertificateCardList
        certificates={[]}
        title="My Certificates"
        description="Custom description"
      />,
    );

    expect(screen.getByRole('heading', { name: 'My Certificates' })).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });

  it('stays gated even when showExport is explicitly true', () => {
    render(<CertificateCardList certificates={[]} showExport={true} />);

    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
  });
});

describe('CertificateCardList — certificates present (#6)', () => {
  it('shows the Select and Export controls by default', () => {
    render(<CertificateCardList certificates={[CERT]} />);

    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    expect(screen.getByText('Infection Control')).toBeInTheDocument();
  });

  it('hides the Select and Export controls when showExport is explicitly false, without affecting the cards', () => {
    render(<CertificateCardList certificates={[CERT]} showExport={false} />);

    expect(
      screen.queryByRole('combobox', { name: 'Filter certificates by date range' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
    expect(screen.getByText('Infection Control')).toBeInTheDocument();
  });
});
