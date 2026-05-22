import { Prisma } from '@prisma/client';

export type CourseWithStats = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  status: string;
  duration: number | null;
  createdAt: Date;
  updatedAt: Date;
  lessonsCount: number;
  enrollmentsCount: number;
  completionRate: number;
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

export type CourseWithRelations = Prisma.CourseGetPayload<{
  include: {
    lessons: {
      include: {
        quiz: {
          include: { questions: true };
        };
      };
    };
    enrollments: {
      include: {
        user: { include: { profile: true } };
        certificate: true;
      };
    };
    creator: {
      include: { profile: true };
    };
  };
}>;

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
