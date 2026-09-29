/**
 * BUG-18 — the status and media-check actions now RETURN their refusals (a
 * thrown message is redacted to React error #441 in production). The list page
 * must show those refusals instead of swallowing them into a log line.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRefresh, mockSetStatus, mockVerifyMedia } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockSetStatus: vi.fn(),
  mockVerifyMedia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));
vi.mock('@/app/actions/video-course', () => ({
  setVideoCourseStatus: mockSetStatus,
  verifyGlobalVideoMedia: mockVerifyMedia,
}));
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({ actions }: { actions: { label: string; onSelect?: () => void }[] }) => (
    <div>
      {actions.map((action) => (
        <button key={action.label} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./VideoCourseForm', () => ({ default: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import VideoCoursesClient, { type VideoCourseRow } from './VideoCoursesClient';

function row(overrides: Partial<VideoCourseRow> = {}): VideoCourseRow {
  return {
    id: 'c1',
    title: 'Fire Safety',
    durationSeconds: 120,
    duration: 2,
    questionCount: 5,
    offeringsCount: 0,
    enrollmentsCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    mediaStatus: 'ready',
    status: 'published',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VideoCoursesClient — returned refusals are shown', () => {
  it('shows a deactivate refusal and does not refresh', async () => {
    mockSetStatus.mockResolvedValue({ success: false, error: 'Unauthorized' });
    render(<VideoCoursesClient courses={[row()]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(
      await screen.findByText('Could not deactivate "Fire Safety": Unauthorized'),
    ).toBeInTheDocument();
    expect(mockSetStatus).toHaveBeenCalledWith('c1', 'inactive');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('shows a reactivate refusal', async () => {
    mockSetStatus.mockResolvedValue({ success: false, error: 'Course not found' });
    render(<VideoCoursesClient courses={[row({ status: 'inactive' })]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(
      await screen.findByText('Could not reactivate "Fire Safety": Course not found'),
    ).toBeInTheDocument();
  });

  it('refreshes and shows no error when the status change succeeds', async () => {
    mockSetStatus.mockResolvedValue({ success: true });
    render(<VideoCoursesClient courses={[row()]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByText('Status change failed')).not.toBeInTheDocument();
  });

  it('shows a media-check refusal', async () => {
    mockVerifyMedia.mockResolvedValue({ success: false, error: 'Unauthorized' });
    render(<VideoCoursesClient courses={[row()]} />);

    await userEvent.click(screen.getByRole('button', { name: /Verify media/ }));

    expect(await screen.findByText('Media check failed')).toBeInTheDocument();
    expect(screen.getByText('Unauthorized')).toBeInTheDocument();
  });

  it('reports the media-check counts on success', async () => {
    mockVerifyMedia.mockResolvedValue({ success: true, checked: 3, missing: 1 });
    render(<VideoCoursesClient courses={[row()]} />);

    await userEvent.click(screen.getByRole('button', { name: /Verify media/ }));

    expect(
      await screen.findByText(/3 videos checked · 1 missing from storage/),
    ).toBeInTheDocument();
  });
});
