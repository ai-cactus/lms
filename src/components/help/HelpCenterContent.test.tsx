/**
 * Regression tests for TC-064 — the Help Center was static (no search). A
 * client-side search now filters the FAQ list by question + answer text and
 * shows an empty state for a query matching nothing.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import HelpCenterContent from './HelpCenterContent';

describe('HelpCenterContent — search', () => {
  it('shows every FAQ item by default (empty query)', () => {
    render(<HelpCenterContent />);

    expect(screen.getByText('How do I start an assigned training?')).toBeInTheDocument();
    expect(screen.getByText('Where can I find my certificates?')).toBeInTheDocument();
    expect(screen.getByText('What happens if I fail a quiz?')).toBeInTheDocument();
  });

  it('filters the FAQ list by a question-text match', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent />);

    await user.type(screen.getByPlaceholderText(/search help articles/i), 'certificates');

    expect(screen.getByText('Where can I find my certificates?')).toBeInTheDocument();
    expect(screen.queryByText('How do I start an assigned training?')).not.toBeInTheDocument();
    expect(screen.queryByText('What happens if I fail a quiz?')).not.toBeInTheDocument();
  });

  it('filters by a match in the answer body, not just the question', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent />);

    // "retake" only appears in the quiz-failure answer body, not in any question.
    await user.type(screen.getByPlaceholderText(/search help articles/i), 'retake');

    expect(screen.getByText('What happens if I fail a quiz?')).toBeInTheDocument();
    expect(screen.queryByText('Where can I find my certificates?')).not.toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent />);

    await user.type(screen.getByPlaceholderText(/search help articles/i), 'PASSWORD');

    expect(screen.getByText('Why am I being asked to reset my password?')).toBeInTheDocument();
  });

  it('shows an empty state for a query matching nothing, quoting the query back', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent />);

    await user.type(screen.getByPlaceholderText(/search help articles/i), 'xyznonsense');

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.getByText(/xyznonsense/)).toBeInTheDocument();
    expect(screen.queryByText('How do I start an assigned training?')).not.toBeInTheDocument();
  });

  it('restores the full list when the query is cleared', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent />);

    const input = screen.getByPlaceholderText(/search help articles/i);
    await user.type(input, 'xyznonsense');
    expect(screen.getByText('No results found')).toBeInTheDocument();

    await user.clear(input);

    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    expect(screen.getByText('How do I start an assigned training?')).toBeInTheDocument();
  });
});
