/**
 * The course-list redesign swapped MyCoursesTable's hand-rolled thumbnail for
 * the shared `CourseThumbnail`, keyed off `course.type`. This pins that the
 * row actually renders the reading tile vs. the video frame per row — not
 * just that the wrapper compiles.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MyCoursesTable from './MyCoursesTable';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const BASE_COURSE = {
  thumbnail: null,
  level: null,
  enrollmentsCount: 3,
  completionRate: 50,
  createdAt: new Date('2026-01-01'),
};

describe('MyCoursesTable — thumbnail per course type', () => {
  it('renders the dark reading tile for a text course and the video frame for a video course', () => {
    render(
      <MyCoursesTable
        courses={[
          { ...BASE_COURSE, id: 'c1', title: 'Reading Course', type: 'text' },
          { ...BASE_COURSE, id: 'c2', title: 'Video Course', type: 'video' },
        ]}
      />,
    );

    const readingRow = screen.getByText('Reading Course').closest('tr')!;
    expect(readingRow.querySelector('[class*="bg-[#1c213d]"]')).not.toBeNull();
    expect(readingRow.querySelector('img')).toBeNull();

    const videoRow = screen.getByText('Video Course').closest('tr')!;
    expect(videoRow.querySelector('img')).not.toBeNull();
    expect(videoRow.querySelector('[class*="bg-[#1c213d]"]')).toBeNull();
  });

  it('treats a missing type as a reading course, never as a broken video frame', () => {
    render(
      <MyCoursesTable
        courses={[{ ...BASE_COURSE, id: 'c1', title: 'Untyped Course', type: undefined }]}
      />,
    );

    const row = screen.getByText('Untyped Course').closest('tr')!;
    expect(row.querySelector('[class*="bg-[#1c213d]"]')).not.toBeNull();
  });
});
