/**
 * Regression test: the login form submit handler MUST NOT pass the plaintext
 * password — or a raw (unmasked) email address — to the logger at any level.
 *
 * Security history: the original handleSubmit called
 *   logger.info({ msg: '[Login Client] Submit clicked! Current form data:', data: formData })
 * where formData contained { email, password, rememberMe }, leaking credentials
 * to every log aggregator and browser console.
 *
 * These tests will fail if that leak is ever reintroduced.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — constructed before any vi.mock() factory runs so that the
// factory can close over them and the tests can inspect .mock.calls later.
// ---------------------------------------------------------------------------

const { mockLogInfo, mockLogDebug, mockLogWarn, mockLogError } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks (Vitest hoists vi.mock() calls before all imports)
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  },
  // Use the real maskEmail logic so the component actually masks before logging
  maskEmail: (email: string) => {
    const at = email.indexOf('@');
    if (at < 0) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    return local.length <= 2 ? `***@${domain}` : `${local.slice(0, 2)}***@${domain}`;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

vi.mock('@/app/actions/auth', () => ({
  authenticate: vi.fn().mockResolvedValue({ success: true }),
}));

// next/image doesn't work in jsdom — stub with a plain <img>
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string; [key: string]: unknown }) => <img alt={alt} />,
}));

// AuthHeroSlider uses framer-motion + real image assets; stub it out
vi.mock('@/components/auth/AuthHeroSlider', () => ({ default: () => null }));

// ---------------------------------------------------------------------------
// Import the component under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import LoginPage from './page';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'SuperSecret123!';
// The correctly-masked form that IS safe to appear in logs
const MASKED_EMAIL = 'us***@example.com';

/** Serialize every argument across all logger method calls into one array. */
function allLoggerCallsSerialized(): string[] {
  return [
    ...mockLogInfo.mock.calls,
    ...mockLogDebug.mock.calls,
    ...mockLogWarn.mock.calls,
    ...mockLogError.mock.calls,
  ].map((args) => JSON.stringify(args));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage — PII regression: logger must never receive plaintext credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never passes the plaintext password to any logger method on submit', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your email/i), TEST_EMAIL);
    await user.type(screen.getByPlaceholderText(/enter your password/i), TEST_PASSWORD);
    // Use type="submit" to avoid ambiguity with the "Log In with Microsoft" button
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    // Wait for handleSubmit's first debug log to confirm the submit path executed
    await waitFor(() => expect(mockLogDebug).toHaveBeenCalled());

    const calls = allLoggerCallsSerialized();
    expect(calls.length).toBeGreaterThan(0); // sanity: something was actually logged

    for (const serialized of calls) {
      expect(
        serialized,
        `Logger call must not contain the plaintext password.\nOffending call: ${serialized}`,
      ).not.toContain(TEST_PASSWORD);
    }
  });

  it('never passes the raw unmasked email to any logger method on submit', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your email/i), TEST_EMAIL);
    await user.type(screen.getByPlaceholderText(/enter your password/i), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() => expect(mockLogDebug).toHaveBeenCalled());

    const calls = allLoggerCallsSerialized();
    for (const serialized of calls) {
      expect(
        serialized,
        `Logger call must not contain the raw email address.\nOffending call: ${serialized}`,
      ).not.toContain(TEST_EMAIL);
    }
  });

  it('logs the masked email form, confirming safe logging is active (not just silent)', async () => {
    // This is the positive mirror of the raw-email guard: the component SHOULD
    // log the masked form. If this fails, the entire debug logging path was
    // removed and the guard above loses its teeth.
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your email/i), TEST_EMAIL);
    await user.type(screen.getByPlaceholderText(/enter your password/i), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() => expect(mockLogDebug).toHaveBeenCalled());

    const calls = allLoggerCallsSerialized();
    const hasMasked = calls.some((s) => s.includes(MASKED_EMAIL));
    expect(
      hasMasked,
      `Expected a logger call containing the masked email "${MASKED_EMAIL}", but none found.\nAll calls:\n${calls.join('\n')}`,
    ).toBe(true);
  });

  it('dispatches the authenticate action when valid credentials are submitted', async () => {
    const { authenticate } = await import('@/app/actions/auth');
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your email/i), TEST_EMAIL);
    await user.type(screen.getByPlaceholderText(/enter your password/i), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    // Confirms the form wiring is intact — it must still submit even as the
    // logger restrictions are in place.
    await waitFor(() => expect(authenticate).toHaveBeenCalled());
  });
});
