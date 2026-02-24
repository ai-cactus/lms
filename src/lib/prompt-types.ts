/**
 * TypeScript types for the v3.1 LMS Prompt Pipeline
 * Matches the JSON output schemas defined in prompts.ts
 */

// ─── Shared Types ────────────────────────────────

export interface SourceAnchor {
    docId: string;
    hint: string;
}

// ─── Prompt A: Course JSON Types ─────────────────

export interface ReviewerNote {
    type: 'contradiction' | 'undefined-term' | 'thin-area' | 'needs-review' | 'min-floor-applied' | 'max-cap-applied';
    topic: string;
    description: string;
    affectedModules: string[];
}

export interface SourceDocEntry {
    docId: string;
    label: string;
    hint: string;
}

export interface CourseMeta {
    promptVersion: string;
    status: 'ok' | 'needs_sources';
    titleUsed: string;
    category: string;
    courseDifficulty: string;
    estimatedDurationMinutes: number;
    moduleCount: number;
    objectiveCount: number;
    sourceDocIndex: SourceDocEntry[];
    gaps: string[];
    reviewerNotes: ReviewerNote[];
}

export interface LearningObjective {
    id: string;
    text: string;
    primaryModules: string[];
}

export interface CourseSection {
    sectionId: string;
    heading: string;
    paragraphs: string[];
    doThis: string[];
    avoidThis: string[];
    signalsToEscalate: string[];
    sourceAnchors: SourceAnchor[];
}

export interface CourseSlide {
    slideTitle: string;
    bullets: string[];
    sourceAnchors: SourceAnchor[];
}

export interface AssessmentFocusItem {
    objectiveId: string;
    skill: 'best-next-action' | 'identify-noncompliance' | 'sequence' | 'escalation' | 'modality-check';
    whatToTest: string;
    commonMistake: string;
    sourceAnchors: SourceAnchor[];
}

export interface AssessmentFocus {
    moduleId: string;
    focusItems: AssessmentFocusItem[];
}

export interface CourseModule {
    moduleId: string;
    moduleNumber: number;
    moduleTitle: string;
    moduleSummary: string;
    objectivesCovered: string[];
    keyTerms: string[];
    sourceRefs: string[];
    sections: CourseSection[];
    slides: CourseSlide[];
}

export interface CourseV3 {
    meta: CourseMeta;
    learningObjectives: LearningObjective[];
    modules: CourseModule[];
    assessmentFocus: AssessmentFocus[];
}

// ─── Prompt B: Quiz JSON Types ───────────────────

export type QuestionArchetype =
    | 'best-next-action'
    | 'identify-noncompliance'
    | 'sequence'
    | 'escalation'
    | 'modality-check';

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export interface ArchetypeCounts {
    'best-next-action': number;
    'identify-noncompliance': number;
    'sequence': number;
    'escalation': number;
    'modality-check': number;
}

export interface QuizMeta {
    promptVersion: string;
    requestedQuestionCount: number;
    quizDifficulty: QuizDifficulty;
    totalQuestions: number;
    moduleCount: number;
    objectiveCount: number;
    coverageNote: string;
    archetypeCounts: ArchetypeCounts;
    gaps: string[];
    reviewerNotes: ReviewerNote[];
}

export interface QuestionEvidence {
    moduleSectionId: string;
    moduleSectionHeading: string;
    sourceAnchors: SourceAnchor[];
}

export interface QuestionExplanation {
    correctExplanation: string;
    incorrectOptions: Record<string, string>;
}

export type QualityFlag =
    | 'scenario-first-ok'
    | 'no-new-facts-ok'
    | 'single-best-answer-ok';

export interface QuizQuestion {
    id: string;
    moduleId: string;
    moduleNumber: number;
    moduleTitle: string;
    objectiveId: string;
    difficulty: QuizDifficulty;
    archetype: QuestionArchetype;
    text: string;
    options: string[];
    correctAnswer: number;
    evidence: QuestionEvidence;
    explanation: QuestionExplanation;
    qualityFlags: QualityFlag[];
}

export interface QuizV3 {
    meta: QuizMeta;
    questions: QuizQuestion[];
}
