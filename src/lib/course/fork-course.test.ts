/**
 * Unit tests for src/lib/course/fork-course.ts — the deep-copy mechanic behind
 * both duplicateCourse (same org) and addPrebuiltCourseToOrg (adopt a
 * platform-global course). Covers: full content-tree copy, artifact
 * by-pointer copy, category cross-tenant drop, approval-field reset,
 * title-strategy branching, and the two not-found error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCourseFindUnique,
  mockOrgUserFindUnique,
  mockCategoryFindUnique,
  mockCourseCreate,
  mockModuleCreate,
  mockLessonCreate,
  mockQuizCreate,
  mockQuestionCreate,
  mockArtifactCreate,
} = vi.hoisted(() => ({
  mockCourseFindUnique: vi.fn(),
  mockOrgUserFindUnique: vi.fn(),
  mockCategoryFindUnique: vi.fn(),
  mockCourseCreate: vi.fn(),
  mockModuleCreate: vi.fn(),
  mockLessonCreate: vi.fn(),
  mockQuizCreate: vi.fn(),
  mockQuestionCreate: vi.fn(),
  mockArtifactCreate: vi.fn(),
}));

const tx = {
  course: { findUnique: mockCourseFindUnique, create: mockCourseCreate },
  organizationUser: { findUnique: mockOrgUserFindUnique },
  courseCategory: { findUnique: mockCategoryFindUnique },
  courseModule: { create: mockModuleCreate },
  lesson: { create: mockLessonCreate },
  quiz: { create: mockQuizCreate },
  question: { create: mockQuestionCreate },
  courseArtifact: { create: mockArtifactCreate },
};

vi.mock('@/lib/prisma', () => {
  const prisma = { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  return { prisma, default: prisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { forkCourse } from './fork-course';

const BASE_SOURCE = {
  id: 'course-src',
  title: 'Infection Control',
  description: 'desc',
  thumbnail: null,
  category: 'Compliance',
  categoryId: null,
  duration: 45,
  objectives: null,
  overview: null,
  skillLevel: null,
  previewVideoStorageUri: null,
  previewVideoDurationSeconds: null,
  previewMediaStatus: null,
  promptVersion: 'v4.6',
  rawCourseJson: null,
  rawQuizJson: null,
  rawArticleMarkdown: null,
  rawArticleMeta: null,
  rawJudgeJson: null,
  rawSlidesJson: null,
  type: 'text',
  modules: [] as unknown[],
  lessons: [] as unknown[],
  quiz: null as unknown,
  artifacts: [] as unknown[],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgUserFindUnique.mockResolvedValue({ organizationId: 'org-target' });
  mockCourseCreate.mockResolvedValue({ id: 'course-fork', title: 'Infection Control (copy)' });
  mockModuleCreate.mockImplementation(({ data }: { data: { title: string } }) =>
    Promise.resolve({ id: `mod-${data.title}` }),
  );
  mockLessonCreate.mockImplementation(() => Promise.resolve({ id: 'lesson-fork-1' }));
  mockQuizCreate.mockImplementation(() => Promise.resolve({ id: 'quiz-fork-1' }));
});

describe('forkCourse', () => {
  it('throws when the source course does not exist', async () => {
    mockCourseFindUnique.mockResolvedValue(null);

    await expect(
      forkCourse({
        sourceCourseId: 'missing',
        targetOrganizationUserId: 'ou-1',
        titleStrategy: 'duplicate',
      }),
    ).rejects.toThrow('Course not found');
  });

  it('throws when the target membership does not exist', async () => {
    mockCourseFindUnique.mockResolvedValue(BASE_SOURCE);
    mockOrgUserFindUnique.mockResolvedValue(null);

    await expect(
      forkCourse({
        sourceCourseId: BASE_SOURCE.id,
        targetOrganizationUserId: 'ghost-ou',
        titleStrategy: 'duplicate',
      }),
    ).rejects.toThrow('Target organization membership not found');
  });

  it('suffixes the title with "(copy)" for the duplicate strategy', async () => {
    mockCourseFindUnique.mockResolvedValue(BASE_SOURCE);

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Infection Control (copy)' }),
      }),
    );
  });

  it('keeps the source title verbatim for the catalog strategy', async () => {
    mockCourseFindUnique.mockResolvedValue(BASE_SOURCE);

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'catalog',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Infection Control' }) }),
    );
  });

  it('stamps forkedFromCourseId, resets to an unpublished org-private draft, and clears approval fields', async () => {
    mockCourseFindUnique.mockResolvedValue(BASE_SOURCE);

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          forkedFromCourseId: 'course-src',
          createdByOrgUserId: 'ou-1',
          status: 'draft',
          isGlobal: false,
          reviewRequired: false,
          qualityWarnings: [],
          approvedByOrgUserId: null,
          approvedAt: null,
        }),
      }),
    );
  });

  it('drops a category owned by a different tenant, keeping the free-text label', async () => {
    mockCourseFindUnique.mockResolvedValue({ ...BASE_SOURCE, categoryId: 'cat-1' });
    mockCategoryFindUnique.mockResolvedValue({ id: 'cat-1', organizationId: 'org-other-tenant' });

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: null, category: 'Compliance' }),
      }),
    );
  });

  it('carries a system category (organizationId null) across the fork', async () => {
    mockCourseFindUnique.mockResolvedValue({ ...BASE_SOURCE, categoryId: 'cat-system' });
    mockCategoryFindUnique.mockResolvedValue({ id: 'cat-system', organizationId: null });

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: 'cat-system' }) }),
    );
  });

  it('carries a category owned by the SAME target org across the fork', async () => {
    mockCourseFindUnique.mockResolvedValue({ ...BASE_SOURCE, categoryId: 'cat-1' });
    mockCategoryFindUnique.mockResolvedValue({ id: 'cat-1', organizationId: 'org-target' });

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: 'cat-1' }) }),
    );
  });

  it('deep-copies modules, lessons (incl. lesson-level quiz+questions), a course-level quiz, and artifacts by pointer', async () => {
    mockCourseFindUnique.mockResolvedValue({
      ...BASE_SOURCE,
      modules: [{ id: 'mod-src-1', title: 'Module 1', order: 0 }],
      lessons: [
        {
          id: 'lesson-src-1',
          moduleId: 'mod-src-1',
          title: 'Lesson 1',
          content: 'content',
          slideContent: null,
          order: 0,
          duration: 5,
          videoProvider: null,
          videoStorageUri: null,
          videoDurationSeconds: null,
          mediaStatus: null,
          quiz: {
            title: 'Lesson quiz',
            passingScore: 80,
            allowedAttempts: 2,
            timeLimit: null,
            difficulty: null,
            questions: [
              {
                text: 'Q1',
                type: 'single',
                options: ['a', 'b'],
                correctAnswer: 'a',
                order: 0,
                archetype: null,
                evidence: null,
                explanation: null,
              },
            ],
          },
        },
      ],
      quiz: {
        title: 'Course quiz',
        passingScore: 70,
        allowedAttempts: null,
        timeLimit: 600,
        difficulty: 'medium',
        questions: [
          {
            text: 'Course Q1',
            type: 'single',
            options: null,
            correctAnswer: 'x',
            order: 0,
            archetype: null,
            evidence: null,
            explanation: null,
          },
        ],
      },
      artifacts: [
        {
          type: 'slides',
          storageUri: 'gs://bucket/artifact-1',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          version: 1,
        },
      ],
    });

    const result = await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(result).toEqual({ id: 'course-fork', title: 'Infection Control (copy)' });

    // Module copied under the new course.
    expect(mockModuleCreate).toHaveBeenCalledWith({
      data: { courseId: 'course-fork', title: 'Module 1', order: 0 },
      select: { id: true },
    });

    // Lesson re-parented to the copied module id, not the source module id.
    expect(mockLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courseId: 'course-fork',
          moduleId: 'mod-Module 1',
          title: 'Lesson 1',
        }),
      }),
    );

    // Two quizzes created: one owned by the lesson, one owned by the course.
    expect(mockQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lessonId: 'lesson-fork-1' }) }),
    );
    expect(mockQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courseId: 'course-fork' }) }),
    );
    expect(mockQuizCreate).toHaveBeenCalledTimes(2);

    // Both quizzes' questions copied.
    expect(mockQuestionCreate).toHaveBeenCalledTimes(2);
    expect(mockQuestionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: 'Q1', quizId: 'quiz-fork-1' }),
      }),
    );
    expect(mockQuestionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: 'Course Q1', quizId: 'quiz-fork-1' }),
      }),
    );

    // Artifact copied by pointer — same storageUri, no new object storage write.
    expect(mockArtifactCreate).toHaveBeenCalledWith({
      data: {
        courseId: 'course-fork',
        type: 'slides',
        storageUri: 'gs://bucket/artifact-1',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        version: 1,
      },
    });
  });

  it('handles a lesson with no moduleId (unassigned lesson) without crashing', async () => {
    mockCourseFindUnique.mockResolvedValue({
      ...BASE_SOURCE,
      lessons: [
        {
          id: 'lesson-src-1',
          moduleId: null,
          title: 'Orphan lesson',
          content: null,
          slideContent: null,
          order: 0,
          duration: null,
          videoProvider: null,
          videoStorageUri: null,
          videoDurationSeconds: null,
          mediaStatus: null,
          quiz: null,
        },
      ],
    });

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    expect(mockLessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ moduleId: null }) }),
    );
    expect(mockQuizCreate).not.toHaveBeenCalled();
  });

  it('never copies a null JSON column as a literal JSON null (writes undefined instead)', async () => {
    mockCourseFindUnique.mockResolvedValue({ ...BASE_SOURCE, rawCourseJson: null });

    await forkCourse({
      sourceCourseId: BASE_SOURCE.id,
      targetOrganizationUserId: 'ou-1',
      titleStrategy: 'duplicate',
    });

    const data = mockCourseCreate.mock.calls[0][0].data;
    expect(data.rawCourseJson).toBeUndefined();
    expect('rawCourseJson' in data).toBe(true);
  });
});
