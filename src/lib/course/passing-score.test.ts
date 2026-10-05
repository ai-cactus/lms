import { describe, it, expect } from 'vitest';
import { coursePassingScore } from './passing-score';

const course = (quiz: number | null, lessonQuizzes: (number | null)[] = []) => ({
  id: 'course-1',
  quiz: quiz === null ? null : { passingScore: quiz },
  lessons: lessonQuizzes.map((bar) => ({ quiz: bar === null ? null : { passingScore: bar } })),
});

describe('coursePassingScore', () => {
  it('defaults to 70 for a course with no quiz', () => {
    expect(coursePassingScore(course(null, [null, null]))).toBe(70);
  });

  it('uses the course-level quiz bar', () => {
    expect(coursePassingScore(course(80))).toBe(80);
  });

  it('takes the STRICTEST bar across course- and lesson-level quizzes, as the dashboards do', () => {
    expect(coursePassingScore(course(60, [85, null, 75]))).toBe(85);
    expect(coursePassingScore(course(null, [65]))).toBe(65);
  });
});
