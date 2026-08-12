/**
 * The server learn page (PR 6).
 *
 * Making the page server-render its own payload moved the access decision from
 * "the client fetch got a 403" to "the page never renders". These lock down that
 * the page maps every `getLearnPayload` outcome the way the route's status codes
 * used to, so no denied caller is handed a rendered learn experience.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetLearnPayload, mockNotFound, mockRedirect } = vi.hoisted(() => ({
  mockGetLearnPayload: vi.fn(),
  // Both of these terminate rendering by throwing in Next; mirror that so a page
  // that failed to bail out cannot silently fall through to the client.
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }));
vi.mock('@/lib/learn/get-learn-payload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/learn/get-learn-payload')>(
    '@/lib/learn/get-learn-payload',
  );
  return { ...actual, getLearnPayload: mockGetLearnPayload };
});
vi.mock('./LearnClient', () => ({
  default: ({ initialData }: { initialData?: unknown }) => (
    <div data-testid="learn-client" data-seeded={initialData ? 'true' : 'false'} />
  ),
}));

import LearnPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('learn page — access outcomes', () => {
  it('does not render for a caller who is not enrolled', async () => {
    mockGetLearnPayload.mockResolvedValue({ error: 'Not enrolled in this course', status: 403 });

    await expect(LearnPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('does not render when the course does not exist', async () => {
    mockGetLearnPayload.mockResolvedValue({ error: 'Course not found', status: 404 });

    await expect(LearnPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('sends an unauthenticated caller to the login page', async () => {
    mockGetLearnPayload.mockResolvedValue({ error: 'Unauthorized', status: 401 });

    await expect(LearnPage({ params })).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('falls back to the unseeded client on a server-side fault', async () => {
    mockGetLearnPayload.mockResolvedValue({ error: 'Internal server error', status: 500 });

    const element = await LearnPage({ params });

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(element.props.initialData).toBeUndefined();
  });

  it('seeds the client with the payload for an authorised caller', async () => {
    const payload = { course: { id: 'course-1' } };
    mockGetLearnPayload.mockResolvedValue(payload);

    const element = await LearnPage({ params });

    expect(element.props.initialData).toBe(payload);
  });
});
