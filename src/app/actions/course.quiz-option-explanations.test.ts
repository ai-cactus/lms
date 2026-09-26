/**
 * Founder ruling Q-19: per-option rationale must reach the learner, which means
 * it must first reach the DATABASE. Before this, every AI path produced a
 * rationale per distractor and every writer threw it away on the floor.
 *
 * These tests pin the two writers against `Question.incorrectOptionExplanations`:
 *
 *  - the map is persisted, keyed by the option's index in the `options` array
 *    written in the SAME statement;
 *  - a question with no distractor rationale stores `undefined` (SQL NULL),
 *    never `{}` — a stored empty object reads as "has rationale" to every
 *    consumer and draws an explanation block with nothing in it;
 *  - `updateQuizQuestions` shuffles the options it is given, so it must re-key
 *    the map through the same permutation. An index-keyed map stored beside a
 *    reordered array explains the wrong answers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth } = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn(), create: vi.fn() },
    question: { deleteMany: vi.fn(), createMany: vi.fn() },
    documentVersion: { findFirst: vi.fn() },
    courseVersion: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAdminAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ notifyOrganizationAdmins: vi.fn() }));
vi.mock('./enrollment', () => ({ enrollUsers: vi.fn(), assignCourseToRoles: vi.fn() }));

import { createFullCourse, updateQuizQuestions } from './course';

const ORG = 'org-1';
const OPTIONS = ['24 hours', '48 hours', '72 hours', '7 days'];

function session() {
  return { user: { id: 'u1', role: 'owner', organizationId: ORG, organizationUserId: 'ou-1' } };
}

/** The question rows `createFullCourse` nested into its single `course.create`. */
function createdQuestions() {
  const data = prismaMock.course.create.mock.calls[0][0].data;
  return data.lessons.create[0].quiz.create.questions.create;
}

/** The rows `updateQuizQuestions` handed to `question.createMany`. */
function writtenQuestions() {
  return prismaMock.question.createMany.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(session());
  prismaMock.course.create.mockResolvedValue({ id: 'course-1', lessons: [] });
  prismaMock.course.findUnique.mockResolvedValue({
    id: 'course-1',
    createdByOrgUserId: 'ou-1',
    creator: { organizationId: ORG },
    lessons: [{ id: 'lesson-1', quiz: { id: 'quiz-1' } }],
  });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prismaMock) : [],
  );
});

const baseCourseInput = {
  title: 'Infection Control',
  description: 'desc',
  difficulty: 'beginner',
  duration: '30',
  modules: [{ title: 'Module 1', content: 'content', duration: '10 min' }],
  assignments: [],
};

describe('createFullCourse — persists per-option rationale', () => {
  it('stores the distractor map alongside the options it is keyed against', async () => {
    await createFullCourse({
      ...baseCourseInput,
      quiz: [
        {
          question: 'How soon must an incident be reported?',
          options: OPTIONS,
          answer: 2,
          explanation: {
            correctExplanation: 'Policy states 72 hours.',
            incorrectOptions: {
              '0': 'Understates the window (D1).',
              '1': 'Understates the window (D2).',
              '3': 'Overshoots the window (D4).',
            },
          },
        },
      ],
    });

    const [question] = createdQuestions();
    expect(question.options).toEqual(OPTIONS);
    expect(question.correctAnswer).toBe('72 hours');
    expect(question.explanation).toBe('Policy states 72 hours.');
    expect(question.incorrectOptionExplanations).toEqual({
      '0': 'Understates the window (D1).',
      '1': 'Understates the window (D2).',
      '3': 'Overshoots the window (D4).',
    });
  });

  it('keeps a partial map — an option the model said nothing about is simply absent', async () => {
    await createFullCourse({
      ...baseCourseInput,
      quiz: [
        {
          question: 'How soon must an incident be reported?',
          options: OPTIONS,
          answer: 2,
          explanation: {
            correctExplanation: 'Policy states 72 hours.',
            incorrectOptions: { '3': 'Overshoots the window (D4).' },
          },
        },
      ],
    });

    expect(createdQuestions()[0].incorrectOptionExplanations).toEqual({
      '3': 'Overshoots the window (D4).',
    });
  });

  it('stores undefined, never {}, when no distractor rationale exists', async () => {
    await createFullCourse({
      ...baseCourseInput,
      quiz: [
        {
          question: 'How soon must an incident be reported?',
          options: OPTIONS,
          answer: 2,
          explanation: { correctExplanation: 'Policy states 72 hours.', incorrectOptions: {} },
        },
      ],
    });

    expect(createdQuestions()[0].incorrectOptionExplanations).toBeUndefined();
  });

  it('stores undefined for a legacy question that carries no explanation object at all', async () => {
    await createFullCourse({
      ...baseCourseInput,
      quiz: [{ question: 'Legacy?', options: OPTIONS, answer: 0 }],
    });

    expect(createdQuestions()[0].incorrectOptionExplanations).toBeUndefined();
  });
});

describe('updateQuizQuestions — re-keys per-option rationale through its shuffle', () => {
  /**
   * Each rationale names the option it belongs to, so the invariant holds for
   * ANY permutation: whatever index a rationale ends up under must be the index
   * of the option it names. Repeated because the shuffle is random — a single
   * run can pass on the identity permutation while the mapping is broken.
   */
  it('every stored key still points at the option its rationale describes', async () => {
    for (let run = 0; run < 25; run++) {
      vi.clearAllMocks();
      prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prismaMock) : [],
      );

      await updateQuizQuestions('course-1', [
        {
          question: 'How soon must an incident be reported?',
          options: OPTIONS,
          answer: 2,
          explanation: 'Policy states 72 hours.',
          incorrectOptionExplanations: {
            '0': 'about 24 hours',
            '1': 'about 48 hours',
            '3': 'about 7 days',
          },
        },
      ]);

      const [written] = writtenQuestions();
      expect(written.correctAnswer).toBe('72 hours');
      expect(Object.keys(written.incorrectOptionExplanations)).toHaveLength(3);

      for (const [index, rationale] of Object.entries(
        written.incorrectOptionExplanations as Record<string, string>,
      )) {
        expect(rationale).toBe(`about ${written.options[Number(index)]}`);
      }
    }
  });

  it('stores undefined when the author sent no per-option rationale', async () => {
    await updateQuizQuestions('course-1', [
      {
        question: 'How soon must an incident be reported?',
        options: OPTIONS,
        answer: 2,
        explanation: 'Policy states 72 hours.',
      },
    ]);

    expect(writtenQuestions()[0].incorrectOptionExplanations).toBeUndefined();
  });

  it('stores undefined rather than {} when every rationale sent is blank', async () => {
    await updateQuizQuestions('course-1', [
      {
        question: 'How soon must an incident be reported?',
        options: OPTIONS,
        answer: 2,
        incorrectOptionExplanations: { '0': '   ', '1': '' },
      },
    ]);

    expect(writtenQuestions()[0].incorrectOptionExplanations).toBeUndefined();
  });
});
