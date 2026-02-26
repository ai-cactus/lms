/**
 * TypeScript types for the v4.6 LMS Prompt Pipeline
 * Matches the JSON output schemas defined in prompts-v4.6.ts
 */

// ─── Shared Types ────────────────────────────────

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export type NormModality = 'must' | 'should' | 'may' | 'prohibited' | 'conditional';

export type TemplateId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export type DistractorType = 'D1' | 'D2' | 'D3' | 'D4' | 'D5';

export type TemplateSkill =
    | 'modality-check'
    | 'apply-rule'
    | 'identify-error'
    | 'best-justification'
    | 'classification';

// ─── Prompt A: articleMeta Types ─────────────────

export interface ArticleMetaMeta {
    promptVersion: string;
    status: 'ok' | 'needs_sources';
    title: string;
    sourceLabel: string;
    sectionCount: number;
    objectiveCount: number;
    gaps: string[];
    reviewerNotes: string[];
}

export interface LearningObjectiveV46 {
    id: string;
    text: string;
    primarySections: string[];
}

export interface ArticleSectionV46 {
    sectionId: string;
    title: string;
    anchorHint: string;
    keyPoints: string[];
    normIds: string[];
    snippetIds: string[];
}

export interface SnippetV46 {
    snippetId: string;
    sectionId: string;
    anchorHint: string;
    text: string;
}

export interface NormV46 {
    normId: string;
    sectionId: string;
    modality: NormModality;
    statement: string;
    snippetId: string;
}

export interface ArticleMetaV46 {
    meta: ArticleMetaMeta;
    learningObjectives: LearningObjectiveV46[];
    sections: ArticleSectionV46[];
    snippets: SnippetV46[];
    norms: NormV46[];
}

// ─── Prompt B: Slides Types ─────────────────────

export interface SlidesMeta {
    promptVersion: string;
    basedOnArticleMetaVersion: string;
    desiredSlideCount: number;
    totalSlides: number;
    gaps: string[];
    reviewerNotes: string[];
}

export interface SlideV46 {
    slideId: string;
    title: string;
    bullets: string[];
    sourceSections: string[];
}

export interface SlidesV46 {
    meta: SlidesMeta;
    slides: SlideV46[];
}

// ─── Prompt C: Quiz Types ───────────────────────

export interface QuizMetaV46 {
    promptVersion: string;
    basedOnArticleMetaVersion: string;
    requestedQuestionCount: number;
    quizDifficulty: string;
    totalQuestions: number;
    coverageNote: string;
    gaps: string[];
    reviewerNotes: string[];
}

export interface QuizOptionV46 {
    text: string;
    isCorrect: boolean;
    distractorType: DistractorType | null;
    explanation: string;
}

export interface QuizEvidenceV46 {
    snippetId: string;
    sectionId: string;
}

export interface QuizQuestionV46 {
    id: string;
    sectionId: string;
    templateId: TemplateId;
    skill: TemplateSkill;
    difficulty: QuizDifficulty;
    stimulus: string;
    question: string;
    evidence: QuizEvidenceV46;
    options: QuizOptionV46[];
}

export interface QuizV46 {
    meta: QuizMetaV46;
    questions: QuizQuestionV46[];
}

// ─── Prompt D: Judge Types ──────────────────────

export interface JudgeMeta {
    promptVersion: string;
    totalQuestions: number;
    ambiguousCount: number;
    invalidCount: number;
    notes: string[];
}

export interface AmbiguousFlag {
    questionId: string;
    why: string;
    defensibleOptions: number[];
    suggestedFix: string;
}

export interface InvalidFlag {
    questionId: string;
    type: string;
    why: string;
    suggestedFix: string;
}

export interface JudgeV46 {
    meta: JudgeMeta;
    ambiguous: AmbiguousFlag[];
    invalid: InvalidFlag[];
}

// ─── Prompt E: Regen Types ──────────────────────

export interface RegenMeta {
    promptVersion: string;
    regeneratedCount: number;
    reviewerNotes: string[];
}

export interface RegenV46 {
    meta: RegenMeta;
    questions: QuizQuestionV46[];
}
