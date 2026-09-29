/**
 * Unit tests for src/lib/notifications/live-course-links.ts (BUG-24): a notice
 * whose `/learn/<id>` link names a course that is archived (or gone) is sent to
 * the recipient's training list instead of a 404; every other link is untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { course: { findMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

import { learnLinkCourseId, withLiveCourseLinks } from './live-course-links';

const notice = (id: string, linkUrl: string | null) => ({ id, linkUrl, title: `n-${id}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('learnLinkCourseId', () => {
  it.each([
    ['/learn/course-1', 'course-1'],
    ['/learn/course-1?tab=quiz', 'course-1'],
    ['/learn/course-1/quiz', 'course-1'],
    ['/worker/trainings', null],
    ['/dashboard/learn/course-1', null],
    [null, null],
  ])('%s → %s', (link, expected) => {
    expect(learnLinkCourseId(link)).toBe(expected);
  });
});

describe('withLiveCourseLinks', () => {
  it('re-points a worker notice for an archived course at the worker training list', async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: 'live' }]);

    const result = await withLiveCourseLinks(
      [
        notice('1', '/learn/archived'),
        notice('2', '/learn/live'),
        notice('3', '/worker/trainings'),
      ],
      'nurse',
    );

    expect(result.map((n) => n.linkUrl)).toEqual([
      '/worker/trainings',
      '/learn/live',
      '/worker/trainings',
    ]);
    // Everything but the link survives the rewrite.
    expect(result[0]).toEqual({ id: '1', linkUrl: '/worker/trainings', title: 'n-1' });
  });

  it('re-points a manager-category notice at the admin home, where their own learning starts', async () => {
    prismaMock.course.findMany.mockResolvedValue([]);

    const [result] = await withLiveCourseLinks([notice('1', '/learn/archived')], 'hr');

    expect(result.linkUrl).toBe('/dashboard');
  });

  it('looks every linked course up in ONE query, through the archive-filtered client', async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    await withLiveCourseLinks(
      [notice('1', '/learn/a'), notice('2', '/learn/b'), notice('3', '/learn/a')],
      'nurse',
    );

    expect(prismaMock.course.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      select: { id: true },
    });
  });

  it('queries nothing and returns the page unchanged when no link opens a course', async () => {
    const page = [notice('1', '/dashboard/status-tracker'), notice('2', null)];

    const result = await withLiveCourseLinks(page, 'admin');

    expect(result).toBe(page);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });
});
