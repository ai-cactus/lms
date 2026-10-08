/**
 * Q-35: the learner's "Request retry" control. Offered only on a locked
 * enrolment; "Retry requested" while a request stands; refusals are RETURNED by
 * the action and shown, never swallowed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequestCourseRetry, mockRefresh, mockLoggerError } = vi.hoisted(() => ({
  mockRequestCourseRetry: vi.fn(),
  mockRefresh: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/app/actions/enrollment', () => ({ requestCourseRetry: mockRequestCourseRetry }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
}));

import RequestRetryButton from './RequestRetryButton';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RequestRetryButton', () => {
  it('renders nothing for an enrolment that is not locked', () => {
    const { container } = render(<RequestRetryButton enrollmentId="enr-1" status="in_progress" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('sends the request, then shows Retry requested and refreshes the page', async () => {
    mockRequestCourseRetry.mockResolvedValue({
      success: true,
      requestedAt: new Date().toISOString(),
    });
    render(<RequestRetryButton enrollmentId="enr-1" status="locked" />);

    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(mockRequestCourseRetry).toHaveBeenCalledWith('enr-1');
    expect(await screen.findByText('Retry requested')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request retry' })).not.toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('treats an earlier request that still stands as sent', async () => {
    mockRequestCourseRetry.mockResolvedValue({
      success: true,
      alreadyRequested: true,
      requestedAt: new Date().toISOString(),
    });
    render(<RequestRetryButton enrollmentId="enr-1" status="locked" />);

    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(await screen.findByText('Retry requested')).toBeInTheDocument();
  });

  it("shows the action's returned refusal and keeps the button", async () => {
    mockRequestCourseRetry.mockResolvedValue({
      success: false,
      refusedReason: 'You have sent several retry requests in a short time.',
    });
    render(<RequestRetryButton enrollmentId="enr-1" status="locked" />);

    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('several retry requests');
    expect(screen.getByRole('button', { name: 'Request retry' })).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('shows a generic message and logs when the action throws', async () => {
    mockRequestCourseRetry.mockRejectedValue(new Error('network'));
    render(<RequestRetryButton enrollmentId="enr-1" status="locked" />);

    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not send your retry request. Please try again.',
    );
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('starts as Retry requested for a request inside the cool-down, and hides when asked to', () => {
    const { rerender } = render(
      <RequestRetryButton enrollmentId="enr-1" status="locked" retryRequestedAt={new Date()} />,
    );
    expect(screen.getByText('Retry requested')).toBeInTheDocument();
    expect(screen.getByText(/Your admin has been notified/)).toBeInTheDocument();

    rerender(
      <RequestRetryButton
        enrollmentId="enr-1"
        status="locked"
        retryRequestedAt={new Date()}
        hideWhenPending
      />,
    );
    expect(screen.queryByText('Retry requested')).not.toBeInTheDocument();
  });
});
