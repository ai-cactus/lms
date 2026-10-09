/**
 * An OAuth sign-in by a member of a soft-deleted organization is redirected to
 * /login?error=OrganizationDeleted; the page must show the exact support copy.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { mockParams } = vi.hoisted(() => ({ mockParams: { error: null as string | null } }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'error' ? mockParams.error : null) }),
}));
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('@/app/actions/auth', () => ({ authenticate: vi.fn() }));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('@/components/auth/AuthHeroSlider', () => ({ default: () => null }));

import LoginPage from './page';

describe('LoginPage — organization deleted', () => {
  it('shows the organization-inactive copy for ?error=OrganizationDeleted', () => {
    mockParams.error = 'OrganizationDeleted';

    render(<LoginPage />);

    expect(
      screen.getByText('This organization is no longer active. Contact support.'),
    ).toBeVisible();
    expect(
      screen.queryByText(/access to this organization has been removed/i),
    ).not.toBeInTheDocument();
  });

  it('shows the access-removed copy, not the organization one, for ?error=AccessRevoked', () => {
    mockParams.error = 'AccessRevoked';

    render(<LoginPage />);

    expect(screen.getByText(/access to this organization has been removed/i)).toBeVisible();
    expect(screen.queryByText(/no longer active/i)).not.toBeInTheDocument();
  });

  it('shows neither with no error', () => {
    mockParams.error = null;

    render(<LoginPage />);

    expect(screen.queryByText(/no longer active/i)).not.toBeInTheDocument();
  });
});
