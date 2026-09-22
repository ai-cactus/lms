import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CourseListStatusBadge from './CourseListStatusBadge';

describe('CourseListStatusBadge', () => {
  it.each([
    ['draft', 0, 'Draft', 'text-[#dc6803]'],
    ['published', 0, 'Published', 'text-[#2563eb]'],
    ['published', 2, 'Assigned', 'text-[#308242]'],
    ['inactive', 0, 'Inactive', 'text-[#666d80]'],
  ])('renders %s with %i enrollments as %s', (status, count, label, toneClass) => {
    render(<CourseListStatusBadge status={status} enrollmentsCount={count} />);

    const badge = screen.getByText(label);
    expect(badge).toHaveClass(toneClass, 'rounded-full', 'whitespace-nowrap');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges a caller className', () => {
    render(<CourseListStatusBadge status="draft" enrollmentsCount={0} className="sm:hidden" />);

    expect(screen.getByText('Draft')).toHaveClass('sm:hidden');
  });
});
