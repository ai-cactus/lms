/**
 * LMS Pipeline Data Contracts
 * 
 * Non-negotiable structure for the 3-prompt pipeline (Architect → Inspector → Teacher)
 * All prompts and parser must agree on these interfaces.
 */

// =============================================================================
// PROMPT A OUTPUT: Course Metadata
// =============================================================================

export interface ModuleRef {
    moduleId: string;           // e.g., "module-1" or "1"
    moduleNumber: number;
    moduleTitle: string;
    sourceRefs: string[];       // e.g., ["Policy ABC v2.3: section 1.2"]
}

export interface LearningObjective {
    id: string;                 // e.g., "LO1", "LO2"
    text: string;
    moduleIds: string[];        // Which modules cover this objective
}

export interface CourseMeta {
    promptVersion: string;      // e.g., "v1.0"
    courseTitle: string;
    courseDescription: string;
    moduleCount: number;
    objectiveCount: number;
    modules: ModuleRef[];
    learningObjectives: LearningObjective[];
    generatedAt: string;        // ISO timestamp
    reviewerNotes?: string;     // Internal notes (not shown to learners)
}

// =============================================================================
// PROMPT B OUTPUT: Quiz
// =============================================================================

export type QuestionDifficulty = 'recall' | 'application' | 'judgment';

export interface QuizQuestion {
    id: string;                 // e.g., "q01", "q02"
    questionText: string;
    moduleId: string;           // Must exist in CourseMeta.modules
    objectiveId: string;        // Must exist in CourseMeta.learningObjectives
    difficulty: QuestionDifficulty;
    options: [string, string, string, string];  // Exactly 4 options
    correctAnswer: 0 | 1 | 2 | 3;               // Index of correct option
}

export interface QuizMeta {
    promptVersion: string;
    totalQuestions: number;
    difficultyDistribution: {
        recall: number;
        application: number;
        judgment: number;
    };
    coverageByModule: Record<string, number>;   // moduleId → question count
    coverageByObjective: Record<string, number>; // objectiveId → question count
}

export interface QuizOutput {
    meta: QuizMeta;
    questions: QuizQuestion[];
}

// =============================================================================
// PROMPT C OUTPUT: Explanations
// =============================================================================

export interface IncorrectOptionExplanation {
    "0"?: string;
    "1"?: string;
    "2"?: string;
    "3"?: string;
}

export interface QuestionExplanation {
    questionId: string;         // Must exist in QuizOutput.questions
    correctExplanation: string;
    incorrectOptions: IncorrectOptionExplanation;  // Keys are option indices (excluding correct)
}

export interface ExplanationsOutput {
    promptVersion: string;
    explanations: QuestionExplanation[];
}

// =============================================================================
// PIPELINE RESULT
// =============================================================================

export interface DiagnosticWarning {
    stage: 'A' | 'B' | 'C' | 'parser';
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    details?: Record<string, any>;
}

export interface Diagnostics {
    pipelineVersion: string;
    runId: string;
    startedAt: string;
    completedAt: string;
    stages: {
        A: { success: boolean; durationMs: number; rawCharCount: number };
        B: { success: boolean; durationMs: number; rawCharCount: number };
        C: { success: boolean; durationMs: number; rawCharCount: number };
    };
    validation: {
        courseMetaValid: boolean;
        quizValid: boolean;
        explanationsValid: boolean;
        crossLinksValid: boolean;
    };
    warnings: DiagnosticWarning[];
    errors: DiagnosticWarning[];
    coverage: {
        modulesWithQuestions: number;
        modulesWithoutQuestions: string[];
        objectivesWithQuestions: number;
        objectivesWithoutQuestions: string[];
        correctAnswerDistribution: Record<number, number>;
    };
}

export interface PipelineResult {
    success: boolean;
    courseMarkdown: string;
    courseMeta: CourseMeta;
    quiz: QuizOutput;
    explanations: ExplanationsOutput;
    diagnostics: Diagnostics;
}

// =============================================================================
// PIPELINE CONFIG
// =============================================================================

export interface PipelineConfig {
    promptVersion: string;
    strict: boolean;            // If true, fail on any error; if false, continue with warnings
    repair: boolean;            // If true, attempt JSON repair
    sanitizeCourse: boolean;    // If true, remove reviewer notes from output
    warnDifficulty: boolean;    // If true, warn on difficulty distribution issues
    maxFileSizeKb: number;
    temperature: number;
    maxRetries: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
    promptVersion: 'v1.0',
    strict: false,
    repair: true,
    sanitizeCourse: true,
    warnDifficulty: true,
    maxFileSizeKb: 5000,
    temperature: 0.3,
    maxRetries: 3
};

// =============================================================================
// PIPELINE INPUT
// =============================================================================

export interface SourceDocument {
    name: string;
    content: string;
    type?: string;
}

export interface CourseMetadataInput {
    title: string;
    description?: string;
    category?: string;
    difficulty?: 'Beginner' | 'Moderate' | 'Advanced';
    duration?: string;
    objectives?: string[];
    complianceMapping?: string;
}

export interface PipelineInput {
    documents: SourceDocument[];
    metadata?: CourseMetadataInput;
    config?: Partial<PipelineConfig>;
}

// =============================================================================
// RAW OUTPUTS (for audit trail)
// =============================================================================

export interface RawPipelineOutputs {
    runId: string;
    timestamp: string;
    promptA: {
        input: string;
        output: string;
        durationMs: number;
    };
    promptB: {
        input: string;
        output: string;
        durationMs: number;
    };
    promptC: {
        input: string;
        output: string;
        durationMs: number;
    };
}
