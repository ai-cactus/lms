/**
 * Tests for the wizard's step-7 slide review: the thumbnail rail built from the
 * whole course deck, the arrow paddles, and the toggle back to the notes view.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import WizardReviewSlides from './WizardReviewSlides';
import { RenderableModule } from '@/types/course';

const slide = (heading: string) =>
  `<div class="rich-slide"><h3 class="slide-heading">${heading}</h3><p>Body copy for ${heading}.</p></div>`;

const LESSONS: RenderableModule[] = [
  {
    id: 'm0-0',
    title: 'Benefits of CARF Principles',
    content: '<p>Notes body.</p>',
    slideContent: slide('Benefits') + slide('Why it matters'),
    duration: '10 min',
    order: 0,
    moduleIndex: 0,
  },
  {
    id: 'm0-1',
    title: 'Challenges for CARF compliance',
    content: '<p>Notes body.</p>',
    slideContent: slide('Challenges'),
    duration: '10 min',
    order: 1,
    moduleIndex: 0,
  },
];

function renderSlides(activeIndex = 0) {
  const onSelectLesson = vi.fn();
  const onViewNotes = vi.fn();

  render(
    <WizardReviewSlides
      lessons={LESSONS}
      activeIndex={activeIndex}
      onSelectLesson={onSelectLesson}
      onViewNotes={onViewNotes}
    />,
  );

  return { onSelectLesson, onViewNotes };
}

describe('WizardReviewSlides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the thumbnail rail from every lesson in the course', () => {
    renderSlides();
    const rail = screen.getByRole('navigation', { name: 'Slides' });
    expect(rail.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Slide 1: Benefits' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('opens on the first slide of the lesson being reviewed', () => {
    renderSlides(1);
    expect(screen.getByRole('button', { name: 'Slide 3: Challenges' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('advances through the deck with the arrow paddles', async () => {
    const user = userEvent.setup();
    renderSlides();

    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByRole('button', { name: 'Slide 2: Why it matters' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('keeps the notes view in sync when the deck crosses into another lesson', async () => {
    const user = userEvent.setup();
    const { onSelectLesson } = renderSlides();

    await user.click(screen.getByRole('button', { name: 'Slide 3: Challenges' }));
    expect(onSelectLesson).toHaveBeenCalledWith(1);
  });

  it('stops at the last slide', async () => {
    const user = userEvent.setup();
    renderSlides();

    await user.click(screen.getByRole('button', { name: 'Slide 3: Challenges' }));
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  });

  it('switches back to the notes view', async () => {
    const user = userEvent.setup();
    const { onViewNotes } = renderSlides();

    await user.click(screen.getByRole('button', { name: 'View as Notes' }));
    expect(onViewNotes).toHaveBeenCalled();
  });

  it('renders the Edit affordance as inert until post-publish editing exists', () => {
    renderSlides();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
