/**
 * Regression tests for /mfa/verify (2FA consolidation):
 *
 *  - Issue 3: the on-mount auto-send must fire EXACTLY ONCE even under React
 *    StrictMode's dev double-invoke of effects. Without the `didSendRef`
 *    guard, a second send overwrites the same mfa_factors row and kills the
 *    first email's code. Reproduced here with RTL's `reactStrictMode: true`
 *    option (NOT a hand-rolled <StrictMode> wrapper — see
 *    .claude/agent-memory/bug-hunter/rtl-strictmode-double-invoke-gotcha.md,
 *    which does not reliably double-invoke effects in this repo's RTL/React
 *    versions).
 *  - Issue 4 (client half): a non-OK /api/auth/mfa/send response (e.g. the
 *    429 rate-limit body) must surface `data.error` in the UI, not leave the
 *    user waiting silently for a code that will never arrive.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPush, mockGet } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockGet }),
}));

// AuthHeroSlider uses framer-motion + real image assets; stub it out (same
// pattern as src/app/(auth)/login/page.test.tsx).
vi.mock('@/components/auth/AuthHeroSlider', () => ({ default: () => null }));

import MfaVerifyPage from './page';

const CHALLENGE = 'a'.repeat(64);

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((key: string) => (key === 'challenge' ? CHALLENGE : null));
  global.fetch = mockFetchOk() as unknown as typeof fetch;
});

describe('MfaVerifyPage — Issue 3: exactly-once auto-send under StrictMode double-invoke', () => {
  it('POSTs /api/auth/mfa/send exactly once even when effects double-invoke', async () => {
    render(<MfaVerifyPage />, { reactStrictMode: true });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const sendCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => url === '/api/auth/mfa/send',
    );
    expect(sendCalls).toHaveLength(1);
  });

  it('redirects to /login and never sends when there is no challenge in the URL', async () => {
    mockGet.mockReturnValue(null);

    render(<MfaVerifyPage />, { reactStrictMode: true });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('MfaVerifyPage — Issue 4: a send failure surfaces in the UI', () => {
  it('shows the {error} message from a 429 rate-limit response instead of failing silently', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many code requests. Please try again later.' }),
    }) as unknown as typeof fetch;

    render(<MfaVerifyPage />);

    expect(
      await screen.findByText('Too many code requests. Please try again later.'),
    ).toBeInTheDocument();
  });

  it('shows a generic fallback message when the failed response has no error field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    render(<MfaVerifyPage />);

    expect(
      await screen.findByText('Could not send a verification code. Please try again.'),
    ).toBeInTheDocument();
  });
});

describe('MfaVerifyPage — basic form wiring', () => {
  it('renders the two-factor authentication heading once a challenge is present', async () => {
    render(<MfaVerifyPage />);

    expect(
      await screen.findByRole('heading', { name: /two-factor authentication/i }),
    ).toBeInTheDocument();
  });
});
