export type CourseWithStats = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  status: string;
  type: string; // 'video' | 'text'
  duration: number | null;
  createdAt: Date;
  updatedAt: Date;
  lessonsCount: number;
  enrollmentsCount: number;
  completionRate: number;
  /**
   * Document the course was generated from, when the caller loaded that lineage.
   * Absent from views that do not query it; null when the course has no
   * `CourseVersion` lineage or the document belongs to another tenant.
   */
  sourceDocumentId?: string | null;
};

export interface CourseWizardData {
  categoryId: string;
  title: string;
  description: string;
  difficulty: string;
  duration: string;
  notesCount: string;
  objectives: string[];
  quizTitle: string;
  quizQuestionCount: string;
  quizDifficulty: string;
  quizQuestionType: string;
  quizDuration: string;
  quizPassMark: string;
  quizAttempts: string;
  assignments: string[];
  dueDate: string;
  dueTime: string;
}

export interface CourseDocument {
  id: string;
  name: string;
  type: 'pdf' | 'docx';
  status: 'analyzed' | 'pending';
  selected: boolean;
  file?: File;
}

export interface GeneratedLesson {
  title: string;
  content: string;
  duration: string;
}

export interface RenderableModule extends GeneratedLesson {
  id: string;
  slideContent: string;
  order: number;
  sectionId?: string;
  keyPoints?: string[];
}

import { Prisma } from '@/generated/prisma/client';
import { QuizQuestion } from './quiz';

export interface GeneratedCourse {
  title: string;
  description: string;
  difficulty: string;
  duration: string;
  objectives: string[];
  modules: RenderableModule[];
  quiz: QuizQuestion[];
  // Raw data fields for v4.6
  rawArticleMeta?: unknown;
  rawArticleMarkdown?: string;
  rawSlidesJson?: unknown;
  rawJudgeJson?: unknown;
  rawQuizJson?: unknown;
  rawCourseJson?: unknown;
  sourceText?: string;
  warning?: string;
}

/**
 * Field selection for the course-detail read path (getCourseById /
 * getCourseForOrgView). Explicit `select` (not `include`) so the query fetches
 * only what the course-detail and preview UIs actually consume — never the heavy
 * raw-AI JSON columns on Course, the full user rows behind enrollments (password
 * hash / MFA secrets), or the per-question answer columns. Every field kept here
 * is read by `TrainingDetails` and/or `CoursePreview`; narrowing it will drop a
 * UI section, so audit those components before removing a field.
 */
export const courseDetailSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  duration: true,
  status: true,
  updatedAt: true,
  overview: true,
  objectives: true,
  skillLevel: true,
  previewVideoStorageUri: true,
  createdBy: true,
  modules: {
    orderBy: { order: 'asc' as const },
    select: {
      id: true,
      title: true,
      order: true,
      lessons: {
        orderBy: { order: 'asc' as const },
        select: { id: true, title: true, order: true, videoDurationSeconds: true },
      },
    },
  },
  quiz: {
    select: {
      title: true,
      passingScore: true,
      questions: { select: { id: true } },
    },
  },
  lessons: {
    orderBy: { order: 'asc' as const },
    select: {
      id: true,
      title: true,
      order: true,
      videoStorageUri: true,
      videoDurationSeconds: true,
      quiz: { select: { passingScore: true } },
    },
  },
  enrollments: {
    select: {
      id: true,
      userId: true,
      status: true,
      score: true,
      progress: true,
      user: { select: { email: true, role: true, profile: { select: { fullName: true } } } },
      certificate: { select: { id: true, issuedAt: true } },
    },
  },
  creator: { select: { email: true, profile: { select: { fullName: true } } } },
} satisfies Prisma.CourseSelect;

export type CourseWithRelations = Prisma.CourseGetPayload<{ select: typeof courseDetailSelect }>;

export type EnrollmentWithRelations = Prisma.EnrollmentGetPayload<{
  include: {
    quizAttempts: true;
    user: {
      include: { profile: true; organization: true };
    };
    course: true;
    certificate: true;
  };
}>;

// Use where an enrollment must carry its assignment batch (schedule / renewal /
// reminders). Kept separate from EnrollmentWithRelations so existing enrollment
// queries aren't forced to include the assignment relation.
export type EnrollmentWithAssignment = Prisma.EnrollmentGetPayload<{
  include: {
    assignment: { include: { reminderStages: true } };
  };
}>;
