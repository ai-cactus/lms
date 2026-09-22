import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CourseThumbnail from './CourseThumbnail';

vi.mock('next/image', () => ({
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} className={className} />
  ),
}));

describe('CourseThumbnail', () => {
  it('renders the reading tile for any non-video course and ignores its artwork', () => {
    const { container } = render(<CourseThumbnail type="text" thumbnail="https://x/a.png" />);

    const tile = container.firstElementChild!;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.className).toContain('size-10');
    expect(tile.className).toContain('bg-[#1c213d]');
    expect(container.querySelector('img')).toBeNull();
  });

  it('treats a missing type as a reading course', () => {
    const { container } = render(<CourseThumbnail type={undefined} thumbnail={null} />);

    expect(container.firstElementChild!.className).toContain('bg-[#1c213d]');
  });

  it('renders the 78x47 video frame by default, washed and badged', () => {
    const { container } = render(<CourseThumbnail type="video" thumbnail="https://x/a.png" />);

    const frame = container.firstElementChild!;
    expect(frame.className).toContain('sm:w-[78px]');
    expect(frame.className).toContain('sm:h-[47px]');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(frame.innerHTML).toMatch(/2c8f88/i);
    expect(frame.querySelector('svg')).toBeTruthy();
  });

  it('fits the 40x40 slot in the compact size', () => {
    const { container } = render(
      <CourseThumbnail type="video" thumbnail="https://x/a.png" size="compact" />,
    );

    const frame = container.firstElementChild!;
    expect(frame.className).toContain('size-10');
    expect(frame.className).not.toContain('w-[78px]');
  });

  it('shows the placeholder mark, unwashed, for a video with no artwork', () => {
    const { container } = render(<CourseThumbnail type="video" thumbnail={null} size="compact" />);

    expect(container.querySelector('img')).toHaveAttribute('src', '/images/icon-course-blue.svg');
    expect(container.firstElementChild!.innerHTML).not.toMatch(/2c8f88/i);
  });
});
