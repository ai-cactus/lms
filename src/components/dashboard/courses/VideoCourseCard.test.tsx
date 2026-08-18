/**
 * VideoCourseCard thumbnail — catalog-page cost regression (PR 5).
 *
 * The card used to mount a `<video preload="metadata">` purely to paint a still
 * frame, so a 12-card page cost 12 authenticated proxy hits and megabytes of MP4
 * headers before the viewer clicked anything. These tests pin the replacement:
 * a plain `<img>` when a poster exists, and the gradient backdrop alone when one
 * doesn't — never a `<video>` again, in any state.
 */
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, it } from 'vitest';

import VideoCourseCard from './VideoCourseCard';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';

const makeCourse = (
  overrides: Partial<VideoCourseAvailabilityRow> = {},
): VideoCourseAvailabilityRow => ({
  id: 'course-1',
  title: 'Bloodborne Pathogens',
  description: 'Annual refresher',
  category: 'Safety',
  durationSeconds: 2700,
  questionCount: 10,
  hasPoster: true,
  isOffered: false,
  offeringId: null,
  ...overrides,
});

/** The thumbnail is decorative (alt=""), so it is not exposed as an image role. */
function thumbnailImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector('img');
}

describe('VideoCourseCard thumbnail', () => {
  it('renders an <img> poster and never a <video>', () => {
    const { container } = render(<VideoCourseCard course={makeCourse()} />);

    const img = thumbnailImg(container);
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/api/courses/course-1/preview-poster');
    // Lazy + async decode keep a long catalog off the critical path.
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('alt', '');
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows the gradient alone when the course has no poster', () => {
    const { container } = render(<VideoCourseCard course={makeCourse({ hasPoster: false })} />);

    // No request is fired at all — a posterless card must not each cost a 404.
    expect(thumbnailImg(container)).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('falls back to the gradient when the poster fails to load', () => {
    const { container } = render(<VideoCourseCard course={makeCourse()} />);

    const img = thumbnailImg(container);
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(thumbnailImg(container)).toBeNull();
  });

  it('still renders the card content around the thumbnail', () => {
    render(<VideoCourseCard course={makeCourse({ hasPoster: false })} />);

    expect(screen.getByRole('heading', { name: 'Bloodborne Pathogens' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Bloodborne Pathogens' })).toHaveAttribute(
      'href',
      '/dashboard/training/courses/course-1',
    );
  });
});
