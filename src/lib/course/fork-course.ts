/**
 * Deep-copies a course into a new, independent course owned by another
 * membership. The live caller is duplicating a course inside an org.
 *
 * This also served adopting a platform prebuilt (`isGlobal`) course into an
 * org until 2026-08-28, when that route was retired: prebuilt courses are
 * video courses owned by every org from creation, so there is nothing to
 * adopt. The `titleStrategy: 'catalog'` branch is what that surface used and
 * currently has no production caller.
 *
 * The whole content tree — modules → lessons → quizzes → questions — is copied.
 * Artifacts are copied BY POINTER (the same `storageUri`), so no object storage
 * is duplicated; artifacts are immutable generated blobs, and a fork that later
 * regenerates simply writes its own.
 *
 * Never copied: enrollments, certificates, offerings, assignments, or the
 * `CourseVersion` source-document lineage. The first three are learner records
 * that belong to the source course; the last is provenance that would point a
 * customer org's course at a document owned by another tenant.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Prisma } from '@/generated/prisma/client';

export type ForkTitleStrategy = 'duplicate' | 'catalog';

export interface ForkCourseInput {
  sourceCourseId: string;
  /** Membership that will own the fork — its organization becomes the tenant. */
  targetOrganizationUserId: string;
  /** `duplicate` suffixes "(copy)"; `catalog` keeps the source title verbatim. */
  titleStrategy: ForkTitleStrategy;
}

export interface ForkedCourse {
  id: string;
  title: string;
}

/**
 * Prisma's Json READ type (`JsonValue`) is not assignable to its WRITE type, and
 * a null column must be written as an unset field rather than as JSON `null`.
 */
function copyJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | undefined {
  return value === null ? undefined : (value as Prisma.InputJsonValue);
}

async function copyQuiz(
  tx: Prisma.TransactionClient,
  source: {
    title: string;
    passingScore: number;
    allowedAttempts: number | null;
    timeLimit: number | null;
    difficulty: string | null;
    questions: {
      text: string;
      type: string;
      options: Prisma.JsonValue | null;
      correctAnswer: string;
      order: number;
      archetype: string | null;
      evidence: Prisma.JsonValue | null;
      explanation: string | null;
    }[];
  },
  owner: { lessonId: string } | { courseId: string },
): Promise<void> {
  const quiz = await tx.quiz.create({
    data: {
      ...owner,
      title: source.title,
      passingScore: source.passingScore,
      allowedAttempts: source.allowedAttempts,
      timeLimit: source.timeLimit,
      difficulty: source.difficulty,
    },
    select: { id: true },
  });

  for (const question of source.questions) {
    await tx.question.create({
      data: {
        quizId: quiz.id,
        text: question.text,
        type: question.type,
        options: copyJson(question.options),
        correctAnswer: question.correctAnswer,
        order: question.order,
        archetype: question.archetype,
        evidence: copyJson(question.evidence),
        explanation: question.explanation,
      },
    });
  }
}

/**
 * Creates the fork in a single transaction and returns it. Throws when the
 * source course or the target membership does not exist — callers own the
 * permission and tenancy checks before calling.
 */
export async function forkCourse(input: ForkCourseInput): Promise<ForkedCourse> {
  const { sourceCourseId, targetOrganizationUserId, titleStrategy } = input;

  const fork = await prisma.$transaction(async (tx) => {
    const source = await tx.course.findUnique({
      where: { id: sourceCourseId },
      include: {
        modules: { orderBy: { order: 'asc' } },
        lessons: {
          orderBy: { order: 'asc' },
          include: { quiz: { include: { questions: { orderBy: { order: 'asc' } } } } },
        },
        quiz: { include: { questions: { orderBy: { order: 'asc' } } } },
        artifacts: true,
      },
    });
    if (!source) {
      throw new Error('Course not found');
    }

    const targetMembership = await tx.organizationUser.findUnique({
      where: { id: targetOrganizationUserId },
      select: { organizationId: true },
    });
    if (!targetMembership) {
      throw new Error('Target organization membership not found');
    }

    // A custom category is scoped to the org that created it, so carrying the FK
    // across a tenant boundary would dangle. System categories (organizationId
    // null) are shared and safe. The free-text `category` label always carries.
    const category = source.categoryId
      ? await tx.courseCategory.findUnique({
          where: { id: source.categoryId },
          select: { id: true, organizationId: true },
        })
      : null;
    const categoryId =
      category &&
      (category.organizationId === null ||
        category.organizationId === targetMembership.organizationId)
        ? category.id
        : null;

    const course = await tx.course.create({
      data: {
        title: titleStrategy === 'duplicate' ? `${source.title} (copy)` : source.title,
        description: source.description,
        thumbnail: source.thumbnail,
        category: source.category,
        categoryId,
        duration: source.duration,
        objectives: source.objectives,
        overview: source.overview,
        skillLevel: source.skillLevel,
        previewVideoStorageUri: source.previewVideoStorageUri,
        previewVideoDurationSeconds: source.previewVideoDurationSeconds,
        previewMediaStatus: source.previewMediaStatus,
        promptVersion: source.promptVersion,
        rawCourseJson: copyJson(source.rawCourseJson),
        rawQuizJson: copyJson(source.rawQuizJson),
        rawArticleMarkdown: source.rawArticleMarkdown,
        rawArticleMeta: copyJson(source.rawArticleMeta),
        rawJudgeJson: copyJson(source.rawJudgeJson),
        rawSlidesJson: copyJson(source.rawSlidesJson),
        type: source.type,
        createdByOrgUserId: targetOrganizationUserId,
        forkedFromCourseId: source.id,
        // A fork always starts unpublished, org-private and unapproved: approval
        // and the publish-review gate are decisions about THIS org's copy.
        status: 'draft',
        isGlobal: false,
        reviewRequired: false,
        qualityWarnings: [],
        approvedByOrgUserId: null,
        approvedAt: null,
      },
      select: { id: true, title: true },
    });

    const moduleIdBySourceId = new Map<string, string>();
    for (const sourceModule of source.modules) {
      const copy = await tx.courseModule.create({
        data: { courseId: course.id, title: sourceModule.title, order: sourceModule.order },
        select: { id: true },
      });
      moduleIdBySourceId.set(sourceModule.id, copy.id);
    }

    for (const lesson of source.lessons) {
      const copy = await tx.lesson.create({
        data: {
          courseId: course.id,
          moduleId: lesson.moduleId ? (moduleIdBySourceId.get(lesson.moduleId) ?? null) : null,
          title: lesson.title,
          content: lesson.content,
          slideContent: lesson.slideContent,
          order: lesson.order,
          duration: lesson.duration,
          videoProvider: lesson.videoProvider,
          videoStorageUri: lesson.videoStorageUri,
          videoDurationSeconds: lesson.videoDurationSeconds,
          mediaStatus: lesson.mediaStatus,
        },
        select: { id: true },
      });

      if (lesson.quiz) {
        await copyQuiz(tx, lesson.quiz, { lessonId: copy.id });
      }
    }

    if (source.quiz) {
      await copyQuiz(tx, source.quiz, { courseId: course.id });
    }

    for (const artifact of source.artifacts) {
      await tx.courseArtifact.create({
        data: {
          courseId: course.id,
          type: artifact.type,
          storageUri: artifact.storageUri,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          version: artifact.version,
        },
      });
    }

    return course;
  });

  logger.info({
    msg: '[course] Course forked',
    courseId: fork.id,
    sourceCourseId,
    targetOrganizationUserId,
    titleStrategy,
  });

  return fork;
}
