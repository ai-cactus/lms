/**
 * Tier 3 item 5.2 — AuthHeroSliderContent is the framer-motion implementation
 * moved verbatim out of AuthHeroSlider.tsx (now lazy-loaded via next/dynamic).
 * No logic changed in the move; these tests pin the pre-existing cycling/
 * navigation behavior so the extraction itself introduced no regression.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AuthHeroSliderContent from './AuthHeroSliderContent';
import { authHeroSlides } from './authHeroSlides';

vi.mock('next/image', () => ({
  default: ({
    alt,
    priority,
    ...rest
  }: {
    alt: string;
    priority?: boolean;
    [key: string]: unknown;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} data-priority={priority ? 'true' : 'false'} {...rest} />
  ),
}));

describe('AuthHeroSliderContent — initial render', () => {
  it('shows slide 0 with a priority image and all four slide-nav buttons', () => {
    render(<AuthHeroSliderContent />);

    expect(screen.getByText(authHeroSlides[0].title)).toBeInTheDocument();
    expect(screen.getByAltText(authHeroSlides[0].title)).toHaveAttribute('data-priority', 'true');
    expect(screen.getAllByRole('button', { name: /go to slide/i })).toHaveLength(
      authHeroSlides.length,
    );
  });
});

describe('AuthHeroSliderContent — manual navigation', () => {
  it('switches the visible title/subtitle when a slide-nav dot is clicked', async () => {
    const user = userEvent.setup();
    render(<AuthHeroSliderContent />);

    await user.click(screen.getByRole('button', { name: /go to slide 3/i }));

    expect(await screen.findByText(authHeroSlides[2].title)).toBeInTheDocument();
    expect(screen.getByText(authHeroSlides[2].subtitle)).toBeInTheDocument();
  });

  it('marks the active slide dot distinctly from inactive ones', async () => {
    const user = userEvent.setup();
    render(<AuthHeroSliderContent />);

    const secondDot = screen.getByRole('button', { name: /go to slide 2/i });
    await user.click(secondDot);

    expect(await screen.findByText(authHeroSlides[1].title)).toBeInTheDocument();
    expect(secondDot.className).toContain('bg-white');
    expect(secondDot.className).not.toContain('bg-white/30');

    const firstDot = screen.getByRole('button', { name: /go to slide 1$/i });
    expect(firstDot.className).toContain('bg-white/30');
  });
});
