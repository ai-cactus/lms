/**
 * Pins the illustrated empty state (7377c4f2) that replaced the bare
 * EmptyTableState, and the export-controls gating from #6 — both conditions
 * now live in the same component and must be verified independently so a
 * regression in one cannot hide behind the other.
 *
 * #6 asked that the date-range Select and Export button not offer an export
 * with nothing to export. They were HIDDEN for that; design 15560:138390 draws
 * them in the empty state with Export greyed, so #6's intent is now met by
 * DISABLING them instead. `showExport={false}` still removes them outright. The
 * <h1> and description stay unconditional — this component is both page chrome
 * and card.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Radix Select drives its trigger through Pointer Events, which jsdom does not
// implement. Same stubs StaffListClient.test.tsx and the wizard step tests use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

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
        description="A subtitle supplied by the page"
      />,
    );

    expect(screen.getByRole('heading', { name: 'My Certificates' })).toBeInTheDocument();
    expect(screen.getByText('A subtitle supplied by the page')).toBeInTheDocument();
  });

  // The empty state was restyled from design 15560:138390, but the page kept
  // passing the pre-redesign subtitle, so the screen carried BOTH messages: the
  // old "will be displayed here" line above the new "No certificate earned yet"
  // block. The subtitle is the design's, adapted to the learner's voice (the
  // design itself is manager-facing — see the 2026-08-28 decision).
  it('carries no trace of the pre-redesign subtitle', () => {
    render(<CertificateCardList certificates={[]} />);

    expect(
      screen.queryByText('Certificates you have earned will be displayed here'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Here's a brief overview of your certificates on the platform."),
    ).toBeInTheDocument();
  });

  it('seats the empty state in the design’s white card rather than on the bare page', () => {
    render(<CertificateCardList certificates={[]} />);

    const card = screen.getByText('No certificate earned yet').closest('div')?.parentElement;
    expect(card).toHaveClass('bg-white', 'rounded-[17px]');
  });

  // Design 15560:138390 draws the header actions in the empty state too, with
  // Export greyed (#c0c0c0) rather than removed.
  it('still renders the header actions, disabled, when there is nothing to act on', () => {
    render(<CertificateCardList certificates={[]} />);

    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeDisabled();
  });
});

/**
 * The date filter used to be a dead control — `defaultValue="7"` with no
 * handler, so picking a range changed nothing. It now really filters, and
 * defaults to "All time" rather than the design's "Last 7 days" chip:
 * certificates are long-lived records, so a 7-day default would hide a
 * learner's own certificate behind an empty state.
 */
describe('CertificateCardList — date range filter', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const recent = {
    ...certificate({ id: 'recent', enrollmentId: 'enrollment-recent0' }),
    course: { title: 'Recent Course' },
    issuedAt: daysAgo(2),
  };
  const older = {
    ...certificate({ id: 'older', enrollmentId: 'enrollment-older000' }),
    course: { title: 'Older Course' },
    issuedAt: daysAgo(90),
  };

  const rangeTrigger = () =>
    screen.getByRole('combobox', { name: 'Filter certificates by date range' });

  it('opens on "All time" and shows every certificate', () => {
    render(<CertificateCardList certificates={[recent, older]} />);

    expect(rangeTrigger()).toHaveTextContent('All time');
    expect(screen.getByText('Recent Course')).toBeInTheDocument();
    expect(screen.getByText('Older Course')).toBeInTheDocument();
  });

  it('narrows the list to the chosen window', async () => {
    const user = userEvent.setup();
    render(<CertificateCardList certificates={[recent, older]} />);

    await user.click(rangeTrigger());
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }));

    expect(screen.getByText('Recent Course')).toBeInTheDocument();
    expect(screen.queryByText('Older Course')).not.toBeInTheDocument();
  });

  it('says the range is empty rather than claiming no certificate was ever earned', async () => {
    const user = userEvent.setup();
    render(<CertificateCardList certificates={[older]} />);

    await user.click(rangeTrigger());
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }));

    expect(screen.getByText('Nothing in this date range')).toBeInTheDocument();
    // The learner HAS a certificate — saying otherwise would read as data loss.
    expect(screen.queryByText('No certificate earned yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse trainings' })).not.toBeInTheDocument();
  });

  it('offers a way back out of an empty range', async () => {
    const user = userEvent.setup();
    render(<CertificateCardList certificates={[older]} />);

    await user.click(rangeTrigger());
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }));
    await user.click(screen.getByRole('button', { name: 'Show all time' }));

    expect(screen.getByText('Older Course')).toBeInTheDocument();
    expect(rangeTrigger()).toHaveTextContent('All time');
  });

  it('disables Export while the current range holds nothing, without disabling the filter', async () => {
    const user = userEvent.setup();
    render(<CertificateCardList certificates={[older]} />);

    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();

    await user.click(rangeTrigger());
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }));

    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
    // The filter must stay live, or the learner cannot undo their own choice.
    expect(rangeTrigger()).toBeEnabled();
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
  it('renders the header actions disabled when there are no certificates, alongside the heading and description', () => {
    render(
      <CertificateCardList
        certificates={[]}
        title="Certificates"
        description="Here's a quick summary of your earned certificates."
      />,
    );

    // Design 15560:138390 draws both controls in the empty state, with Export
    // greyed rather than removed — so they are disabled, not hidden.
    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();

    expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(
      screen.getByText("Here's a quick summary of your earned certificates."),
    ).toBeInTheDocument();
  });

  it('stays disabled with zero certificates even when showExport is explicitly true', () => {
    render(<CertificateCardList certificates={[]} showExport={true} />);

    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
  });

  it('enables the date-range filter and Export button once at least one certificate exists', () => {
    render(<CertificateCardList certificates={[certificate()]} />);

    expect(
      screen.getByRole('combobox', { name: 'Filter certificates by date range' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
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
