/**
 * Zod validation schemas for v4.6 LMS Prompt Pipeline outputs
 * Used for runtime validation of AI responses.
 * Schema tolerance: required keys must exist; extra keys are allowed (.passthrough()).
 */

import { z } from 'zod';

// ─── Prompt A: ArticleMeta Schema ────────────────

const ArticleMetaMetaSchema = z
  .object({
    promptVersion: z.string(),
    status: z.enum(['ok', 'needs_sources']),
    title: z.string(),
    sourceLabel: z.string().optional().default(''),
    sectionCount: z.number().optional().default(0),
    objectiveCount: z.number().optional().default(0),
    gaps: z.array(z.string()).default([]),
    reviewerNotes: z.array(z.string()).default([]),
  })
  .passthrough();

const LearningObjectiveV46Schema = z
  .object({
    id: z.string(),
    text: z.string(),
    primarySections: z.array(z.string()),
  })
  .passthrough();

const ArticleSectionV46Schema = z
  .object({
    sectionId: z.string(),
    title: z.string(),
    anchorHint: z.string().optional().default(''),
    keyPoints: z.array(z.string()).min(1),
    normIds: z.array(z.string()).default([]),
    snippetIds: z.array(z.string()).default([]),
  })
  .passthrough();

const SnippetV46Schema = z
  .object({
    snippetId: z.string(),
    sectionId: z.string(),
    anchorHint: z.string().optional().default(''),
    text: z.string(),
  })
  .passthrough();

const NormV46Schema = z
  .object({
    normId: z.string(),
    sectionId: z.string(),
    modality: z.enum(['must', 'should', 'may', 'prohibited', 'conditional']),
    statement: z.string(),
    snippetId: z.string().optional().default(''),
  })
  .passthrough();

export const ArticleMetaV46Schema = z
  .object({
    meta: ArticleMetaMetaSchema,
    learningObjectives: z.array(LearningObjectiveV46Schema).min(1),
    sections: z.array(ArticleSectionV46Schema).min(1),
    snippets: z.array(SnippetV46Schema).default([]),
    norms: z.array(NormV46Schema).default([]),
  })
  .passthrough();

// ─── Prompt B: Slides Schema ─────────────────────

const SlidesMetaSchema = z
  .object({
    promptVersion: z.string(),
    basedOnArticleMetaVersion: z.string().optional().default('v4.6-article'),
    desiredSlideCount: z.number().optional().default(0),
    totalSlides: z.number().optional().default(0),
    gaps: z.array(z.string()).default([]),
    reviewerNotes: z.array(z.string()).default([]),
  })
  .passthrough();

const SlideV46Schema = z
  .object({
    slideId: z.string(),
    title: z.string(),
    bullets: z.array(z.string()).min(1),
    sourceSections: z.array(z.string()).default([]),
  })
  .passthrough();

export const SlidesV46Schema = z
  .object({
    meta: SlidesMetaSchema,
    slides: z.array(SlideV46Schema).min(1),
  })
  .passthrough();

// ─── Prompt C: Quiz Schema ───────────────────────

const QuizMetaV46Schema = z
  .object({
    promptVersion: z.string(),
    basedOnArticleMetaVersion: z.string().optional().default('v4.6-article'),
    requestedQuestionCount: z.number().optional().default(0),
    quizDifficulty: z.string().optional().default('medium'),
    totalQuestions: z.number().optional().default(0),
    coverageNote: z.string().optional().default(''),
    gaps: z.array(z.string()).default([]),
    reviewerNotes: z.array(z.string()).default([]),
  })
  .passthrough();

const QuizOptionV46Schema = z
  .object({
    text: z.string(),
    isCorrect: z.boolean(),
    distractorType: z.string().nullable().default(null),
    explanation: z.string().optional().default(''),
  })
  .passthrough();

const QuizEvidenceV46Schema = z
  .object({
    snippetId: z.string(),
    sectionId: z.string(),
  })
  .passthrough();

const QuizQuestionV46Schema = z
  .object({
    id: z.string(),
    sectionId: z.string().optional().default(''),
    templateId: z.string().optional().default('T2'),
    skill: z.string().optional().default('apply-rule'),
    difficulty: z.string().optional().default('medium'),
    stimulus: z.string().optional().default(''),
    question: z.string(),
    evidence: QuizEvidenceV46Schema.optional().default({ snippetId: '', sectionId: '' }),
    options: z.array(QuizOptionV46Schema).min(2).max(6),
  })
  .passthrough();

export const QuizV46Schema = z
  .object({
    meta: QuizMetaV46Schema,
    questions: z.array(QuizQuestionV46Schema).min(1),
  })
  .passthrough();

// ─── Prompt D: Judge Schema ──────────────────────

const JudgeMetaSchema = z
  .object({
    promptVersion: z.string(),
    totalQuestions: z.number().optional().default(0),
    ambiguousCount: z.number().optional().default(0),
    invalidCount: z.number().optional().default(0),
    notes: z.array(z.string()).default([]),
  })
  .passthrough();

const AmbiguousFlagSchema = z
  .object({
    questionId: z.string(),
    why: z.string(),
    defensibleOptions: z.array(z.number()).default([]),
    suggestedFix: z.string().optional().default(''),
  })
  .passthrough();

const InvalidFlagSchema = z
  .object({
    questionId: z.string(),
    type: z.string(),
    why: z.string(),
    suggestedFix: z.string().optional().default(''),
  })
  .passthrough();

export const JudgeV46Schema = z
  .object({
    meta: JudgeMetaSchema,
    ambiguous: z.array(AmbiguousFlagSchema).default([]),
    invalid: z.array(InvalidFlagSchema).default([]),
  })
  .passthrough();

// ─── Prompt E: Regen Schema ─────────────────────

const RegenMetaSchema = z
  .object({
    promptVersion: z.string(),
    regeneratedCount: z.number().optional().default(0),
    reviewerNotes: z.array(z.string()).default([]),
  })
  .passthrough();

export const RegenV46Schema = z
  .object({
    meta: RegenMetaSchema,
    questions: z.array(QuizQuestionV46Schema).min(1),
  })
  .passthrough();

// ─── Inferred types from schemas ─────────────────

export type ArticleMetaV46Parsed = z.infer<typeof ArticleMetaV46Schema>;
export type SlidesV46Parsed = z.infer<typeof SlidesV46Schema>;
export type QuizV46Parsed = z.infer<typeof QuizV46Schema>;
export type JudgeV46Parsed = z.infer<typeof JudgeV46Schema>;
export type RegenV46Parsed = z.infer<typeof RegenV46Schema>;
