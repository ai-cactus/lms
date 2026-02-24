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
    sections: z.array(CourseSectionSchema).min(2),
    slides: z.array(CourseSlideSchema).min(1),
}).passthrough();

export const CourseV3Schema = z.object({
    meta: CourseMetaSchema,
    learningObjectives: z.array(LearningObjectiveSchema).min(1),
    modules: z.array(CourseModuleSchema).min(3),
    assessmentFocus: z.array(AssessmentFocusSchema),
}).passthrough();

// ─── Prompt B: Quiz JSON Schema ──────────────────

const QuestionEvidenceSchema = z.object({
    moduleSectionId: z.string(),
    moduleSectionHeading: z.string(),
    sourceAnchors: z.array(SourceAnchorSchema),
}).passthrough();

const QuestionExplanationSchema = z.object({
    correctExplanation: z.string(),
    incorrectOptions: z.record(z.string(), z.string()),
}).passthrough();

const QuizQuestionSchema = z.object({
    id: z.string(),
    moduleId: z.string(),
    moduleNumber: z.number(),
    moduleTitle: z.string(),
    objectiveId: z.string(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    archetype: z.enum(['best-next-action', 'identify-noncompliance', 'sequence', 'escalation', 'modality-check']),
    text: z.string().refine(s => s.startsWith('Scenario: '), {
        message: 'Question text must start with "Scenario: "',
    }),
    options: z.array(z.string()).min(4).max(4),
    correctAnswer: z.number().min(0).max(3),
    evidence: QuestionEvidenceSchema,
    explanation: QuestionExplanationSchema,
    qualityFlags: z.array(z.string()),
}).passthrough();

const ArchetypeCountsSchema = z.object({
    'best-next-action': z.number(),
    'identify-noncompliance': z.number(),
    'sequence': z.number(),
    'escalation': z.number(),
    'modality-check': z.number(),
}).passthrough();

const QuizMetaSchema = z.object({
    promptVersion: z.string(),
    requestedQuestionCount: z.number(),
    quizDifficulty: z.enum(['easy', 'medium', 'hard']),
    totalQuestions: z.number(),
    moduleCount: z.number(),
    objectiveCount: z.number(),
    coverageNote: z.string(),
    archetypeCounts: ArchetypeCountsSchema,
    gaps: z.array(z.string()),
    reviewerNotes: z.array(ReviewerNoteSchema),
}).passthrough();

export const QuizV3Schema = z.object({
    meta: QuizMetaSchema,
    questions: z.array(QuizQuestionSchema).min(1),
}).passthrough();

// ─── Inferred types from schemas ─────────────────

export type CourseV3Parsed = z.infer<typeof CourseV3Schema>;
export type QuizV3Parsed = z.infer<typeof QuizV3Schema>;
