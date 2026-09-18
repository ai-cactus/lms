/**
 * Tests for the learner slide viewer's left thumbnail rail: one numbered
 * preview per page, the active preview marked for assistive tech, and
 * selecting a preview moving the deck.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import CourseSlide from './CourseSlide';

const LESSON_CONTENT = [
  '<h3>Why Hand Hygiene Matters</h3><p>Body copy for the first page.</p>',
  '<h3>When to Wash Your Hands</h3><p>Body copy for the second page.</p>',
  '<h3>The Five Moments</h3><p>Body copy for the third page.</p>',
].join('');

function renderSlide() {
  const onNext = vi.fn();
  const onPrev = vi.fn();

  render(
    <CourseSlide
      lesson={{
        title: 'Module 1: Infection Control',
        content: LESSON_CONTENT,
        moduleIndex: 0,
        totalModules: 4,
      }}
      onNext={onNext}
      onPrev={onPrev}
      isFirst
      isLast={false}
    />,
  );

  return { onNext, onPrev, rail: screen.getByRole('navigation', { name: 'Slides' }) };
}

describe('CourseSlide thumbnail rail', () => {
  it('renders one preview per slide, each showing its slide number', () => {
    const { rail } = renderSlide();

    const thumbnails = within(rail).getAllByRole('button');
    expect(thumbnails).toHaveLength(3);
    thumbnails.forEach((thumbnail, i) => {
      expect(thumbnail).toHaveTextContent(String(i + 1));
    });
  });

  it('marks the slide on screen as the current one', () => {
    renderSlide();

    expect(
      screen.getByRole('button', { name: 'Go to slide 1: Why Hand Hygiene Matters' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByRole('button', { name: 'Go to slide 2: When to Wash Your Hands' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('moves the deck to the slide whose preview is clicked', async () => {
    const user = userEvent.setup();
    renderSlide();

    await user.click(screen.getByRole('button', { name: 'Go to slide 3: The Five Moments' }));

    expect(screen.getByText('Slide 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to slide 3: The Five Moments' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
