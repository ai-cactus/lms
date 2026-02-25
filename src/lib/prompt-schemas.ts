/**
 * Zod validation schemas for v3.1 LMS Prompt Pipeline outputs
 * Used for runtime validation of AI responses.
 * Schema tolerance: required keys must exist; extra keys are allowed.
 */

import { z } from 'zod';

// ─── Shared ──────────────────────────────────────

const SourceAnchorSchema = z.object({
    docId: z.string(),
    hint: z.string(),
}).passthrough();

// ─── Prompt A: Course JSON Schema ────────────────

const ReviewerNoteSchema = z.object({
    type: z.enum(['contradiction', 'undefined-term', 'thin-area', 'needs-review', 'min-floor-applied', 'max-cap-applied']),
    topic: z.string(),
    description: z.string(),
    affectedModules: z.array(z.string()),
}).passthrough();

const SourceDocEntrySchema = z.object({
    docId: z.string(),
    label: z.string(),
    hint: z.string(),
}).passthrough();

const CourseMetaSchema = z.object({
    promptVersion: z.string(),
    status: z.enum(['ok', 'needs_sources']),
    titleUsed: z.string(),
    category: z.string(),
    courseDifficulty: z.string(),
    estimatedDurationMinutes: z.number(),
    moduleCount: z.number(),
    objectiveCount: z.number(),
    sourceDocIndex: z.array(SourceDocEntrySchema),
    gaps: z.array(z.string()),
    reviewerNotes: z.array(ReviewerNoteSchema),
}).passthrough();

const LearningObjectiveSchema = z.object({
    id: z.string(),
    text: z.string(),
    primaryModules: z.array(z.string()),
}).passthrough();

const CourseSectionSchema = z.object({
    sectionId: z.string(),
    heading: z.string(),
    paragraphs: z.array(z.string()),
    doThis: z.array(z.string()),
    avoidThis: z.array(z.string()),
    signalsToEscalate: z.array(z.string()),
    sourceAnchors: z.array(SourceAnchorSchema),
}).passthrough();

const CourseSlideSchema = z.object({
    slideTitle: z.string(),
    bullets: z.array(z.string()),
    sourceAnchors: z.array(SourceAnchorSchema),
}).passthrough();

const AssessmentFocusItemSchema = z.object({
    objectiveId: z.string(),
    skill: z.enum(['best-next-action', 'identify-noncompliance', 'sequence', 'escalation', 'modality-check']),
    whatToTest: z.string(),
    commonMistake: z.string(),
    sourceAnchors: z.array(SourceAnchorSchema),
}).passthrough();

const AssessmentFocusSchema = z.object({
    moduleId: z.string(),
    focusItems: z.array(AssessmentFocusItemSchema),
}).passthrough();

const CourseModuleSchema = z.object({
    moduleId: z.string(),
    moduleNumber: z.number(),
    moduleTitle: z.string(),
    moduleSummary: z.string(),
    objectivesCovered: z.array(z.string()),
    keyTerms: z.array(z.string()),
    sourceRefs: z.array(z.string()),
    sections: z.array(CourseSectionSchema).min(1),
    slides: z.array(CourseSlideSchema).default([]),
}).passthrough();

export const CourseV3Schema = z.object({
    meta: CourseMetaSchema,
    learningObjectives: z.array(LearningObjectiveSchema).min(1),
    modules: z.array(CourseModuleSchema).min(1),
    assessmentFocus: z.array(AssessmentFocusSchema).default([]),
}).passthrough();

// ─── Prompt B: Quiz JSON Schema ──────────────────

const QuestionEvidenceSchema = z.object({
    moduleSectionId: z.string().optional().default(''),
    moduleSectionHeading: z.string().optional().default(''),
    sourceAnchors: z.array(SourceAnchorSchema).default([]),
}).passthrough();

const QuestionExplanationSchema = z.object({
    correctExplanation: z.string().optional().default(''),
    incorrectOptions: z.record(z.string(), z.string()).optional().default({}),
}).passthrough();

const QuizQuestionSchema = z.object({
    id: z.string(),
    moduleId: z.string().optional().default(''),
    moduleNumber: z.number().optional().default(0),
    moduleTitle: z.string().optional().default(''),
    objectiveId: z.string().optional().default(''),
    difficulty: z.string().optional().default('medium'),
    archetype: z.string().optional().default('best-next-action'),
    text: z.string(),
    options: z.array(z.string()).min(2).max(6),
    correctAnswer: z.number().min(0),
    evidence: QuestionEvidenceSchema.optional().default({ moduleSectionId: '', moduleSectionHeading: '', sourceAnchors: [] }),
    explanation: QuestionExplanationSchema.optional().default({ correctExplanation: '', incorrectOptions: {} }),
    qualityFlags: z.array(z.string()).default([]),
}).passthrough();

const ArchetypeCountsSchema = z.object({
    'best-next-action': z.number().optional().default(0),
    'identify-noncompliance': z.number().optional().default(0),
    'sequence': z.number().optional().default(0),
    'escalation': z.number().optional().default(0),
    'modality-check': z.number().optional().default(0),
}).passthrough();

const QuizMetaSchema = z.object({
    promptVersion: z.string().optional().default(''),
    requestedQuestionCount: z.number().optional().default(0),
    quizDifficulty: z.string().optional().default('medium'),
    totalQuestions: z.number().optional().default(0),
    moduleCount: z.number().optional().default(0),
    objectiveCount: z.number().optional().default(0),
    coverageNote: z.string().optional().default(''),
    archetypeCounts: ArchetypeCountsSchema.optional().default({ 'best-next-action': 0, 'identify-noncompliance': 0, 'sequence': 0, 'escalation': 0, 'modality-check': 0 }),
    gaps: z.array(z.string()).default([]),
    reviewerNotes: z.array(ReviewerNoteSchema).default([]),
}).passthrough();

export const QuizV3Schema = z.object({
    meta: QuizMetaSchema,
    questions: z.array(QuizQuestionSchema).min(1),
}).passthrough();

// ─── Inferred types from schemas ─────────────────

export type CourseV3Parsed = z.infer<typeof CourseV3Schema>;
export type QuizV3Parsed = z.infer<typeof QuizV3Schema>;
