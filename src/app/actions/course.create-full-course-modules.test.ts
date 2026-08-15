/**
 * Phase 6 multi-module persistence: a course generated from several documents
 * writes one `CourseModule` per wizard module, links each module's lessons and
 * source document to it, tags every question with the module it came from, and
 * folds a per-module content shortfall into the publish-review gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseCreate,
  mockCourseModuleCreate,
  mockLessonUpdateMany,
  mockDocumentVersionFindMany,
  mockDocumentVersionFindFirst,
  mockCourseVersionCreate,
  mockCourseVersionCreateMany,
  mockEnrollUsers,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseCreate: vi.fn(),
  mockCourseModuleCreate: vi.fn(),
  mockLessonUpdateMany: vi.fn(),
  mockDocumentVersionFindMany: vi.fn(),
  mockDocumentVersionFindFirst: vi.fn(),
  mockCourseVersionCreate: vi.fn(),
  mockCourseVersionCreateMany: vi.fn(),
  mockEnrollUsers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { create: mockCourseCreate },
    courseModule: { create: mockCourseModuleCreate },
    lesson: { updateMany: mockLessonUpdateMany },
    documentVersion: {
      findMany: mockDocumentVersionFindMany,
      findFirst: mockDocumentVersionFindFirst,
    },
    courseVersion: { create: mockCourseVersionCreate, createMany: mockCourseVersionCreateMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('./enrollment', () => ({ enrollUsers: mockEnrollUsers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createFullCourse } from './course';

/** A healthy two-module course: two lessons and two questions per module. */
function twoModuleCourse() {
  return {
    title: 'Infection Control',
    description: 'desc',
    difficulty: 'moderate',
    duration: '60',
    assignments: [],
    modules: [
      { title: 'Intro', content: 'a', duration: '10 min', moduleIndex: 0 },
      { title: 'Detail', content: 'b', duration: '10 min', moduleIndex: 0 },
      { title: 'Practice', content: 'c', duration: '10 min', moduleIndex: 1 },
    ],
    courseModules: [
      {
        title: 'Hand Hygiene',
        objective: 'Wash hands correctly',
        completionDeadlineDays: 14,
        documentId: 'doc-1',
      },
      { title: 'PPE', objective: null, completionDeadlineDays: null, documentId: 'doc-2' },
    ],
    quiz: [
      {
        question: 'Q0',
        options: ['a', 'b'],
        answer: 0,
        moduleIndex: 0,
        moduleTitle: 'Hand Hygiene',
      },
      { question: 'Q1', options: ['a', 'b'], answer: 1, moduleIndex: 1, moduleTitle: 'PPE' },
    ],
    rawArticleMeta: { meta: { status: 'ok' } },
    rawSlidesJson: {
      slides: [
        { slideId: 's1', moduleIndex: 0 },
        { slideId: 's2', moduleIndex: 1 },
      ],
    },
    rawJudgeJson: { ambiguous: [], invalid: [] },
    rawQuizJson: { meta: { requestedQuestionCount: 2 } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'admin-1', organizationUserId: 'ou-admin-1', organizationId: 'org-1' },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockCourseCreate.mockResolvedValue({ id: 'course-1' });
  mockCourseModuleCreate.mockImplementation(async ({ data }: { data: { order: number } }) => ({
    id: `module-${data.order}`,
  }));
  mockDocumentVersionFindMany.mockResolvedValue([
    { id: 'dv-1b', documentId: 'doc-1' },
    { id: 'dv-1a', documentId: 'doc-1' },
    { id: 'dv-2', documentId: 'doc-2' },
  ]);
  mockLessonUpdateMany.mockResolvedValue({ count: 0 });
  mockCourseVersionCreateMany.mockResolvedValue({ count: 0 });
  mockEnrollUsers.mockResolvedValue({
    success: [],
    alreadyEnrolled: [],
    newInvited: [],
    failed: [],
  });
});

describe('createFullCourse — multi-module persistence', () => {
  it('creates one CourseModule per wizard module, in order', async () => {
    await createFullCourse(twoModuleCourse());

    expect(mockCourseModuleCreate).toHaveBeenCalledTimes(2);
    expect(mockCourseModuleCreate.mock.calls[0][0].data).toEqual({
      courseId: 'course-1',
      title: 'Hand Hygiene',
      order: 0,
      objective: 'Wash hands correctly',
      completionDeadlineDays: 14,
    });
    expect(mockCourseModuleCreate.mock.calls[1][0].data).toEqual({
      courseId: 'course-1',
      title: 'PPE',
      order: 1,
      objective: null,
      completionDeadlineDays: null,
    });
  });

  it('links each module’s lessons by their creation order', async () => {
    await createFullCourse(twoModuleCourse());

    expect(mockLessonUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockLessonUpdateMany.mock.calls[0][0]).toEqual({
      where: { courseId: 'course-1', order: { in: [0, 1] } },
      data: { moduleId: 'module-0' },
    });
    expect(mockLessonUpdateMany.mock.calls[1][0]).toEqual({
      where: { courseId: 'course-1', order: { in: [2] } },
      data: { moduleId: 'module-1' },
    });
  });

  it('links each module to the latest version of its own source document', async () => {
    await createFullCourse(twoModuleCourse());

    // One query for every module document — never one per module.
    expect(mockDocumentVersionFindMany).toHaveBeenCalledTimes(1);
    expect(mockDocumentVersionFindMany.mock.calls[0][0].where).toEqual({
      documentId: { in: ['doc-1', 'doc-2'] },
    });

    expect(mockCourseVersionCreateMany).toHaveBeenCalledExactlyOnceWith({
      data: [
        { courseId: 'course-1', documentVersionId: 'dv-1b', moduleId: 'module-0', version: 1 },
        { courseId: 'course-1', documentVersionId: 'dv-2', moduleId: 'module-1', version: 1 },
      ],
    });
    // The single-document CourseVersion path is not used as well.
    expect(mockCourseVersionCreate).not.toHaveBeenCalled();
  });

  it('tags each question’s evidence with the module it was generated from', async () => {
    await createFullCourse(twoModuleCourse());

    const lessons = mockCourseCreate.mock.calls[0][0].data.lessons.create;
    const questions = lessons[lessons.length - 1].quiz.create.questions.create;

    expect(questions[0].evidence).toEqual({ moduleIndex: 0, moduleTitle: 'Hand Hygiene' });
    expect(questions[1].evidence).toEqual({ moduleIndex: 1, moduleTitle: 'PPE' });
  });

  it('publishes a healthy multi-module course without review', async () => {
    const result = await createFullCourse(twoModuleCourse());

    expect(result.reviewRequired).toBe(false);
    expect(result.qualityWarnings).toEqual([]);
  });

  it('flags a module that generated no questions or no slides', async () => {
    const data = twoModuleCourse();
    const result = await createFullCourse({
      ...data,
      // Everything landed in the first module — the second generated nothing.
      quiz: [{ question: 'Q0', options: ['a', 'b'], answer: 0, moduleIndex: 0 }],
      rawSlidesJson: { slides: [{ slideId: 's1', moduleIndex: 0 }] },
      rawQuizJson: { meta: { requestedQuestionCount: 1 } },
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.qualityWarnings).toEqual([
      'No quiz questions were generated for the module “PPE”.',
      'No slides were generated for the module “PPE”.',
    ]);
    expect(mockCourseCreate.mock.calls[0][0].data.status).toBe('draft');
  });

  it('leaves a single-document course on the legacy document link', async () => {
    mockDocumentVersionFindFirst.mockResolvedValue({ id: 'dv-legacy' });

    await createFullCourse({
      title: 'Legacy',
      description: 'desc',
      difficulty: 'moderate',
      duration: '30',
      modules: [{ title: 'M1', content: 'c', duration: '10 min' }],
      quiz: [{ question: 'Q0', options: ['a', 'b'], answer: 0 }],
      assignments: [],
      documentId: 'doc-legacy',
    });

    expect(mockCourseModuleCreate).not.toHaveBeenCalled();
    expect(mockLessonUpdateMany).not.toHaveBeenCalled();
    expect(mockCourseVersionCreate).toHaveBeenCalledExactlyOnceWith({
      data: { courseId: 'course-1', documentVersionId: 'dv-legacy', version: 1 },
    });
  });
});
