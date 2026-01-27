/**
 * LMS Pipeline Runner
 * 
 * Orchestrates the 3-stage prompt pipeline:
 * 1. Prompt A (Architect): Generates course markdown + courseMeta
 * 2. Prompt B (Inspector): Generates quiz grounded in courseMeta
 * 3. Prompt C (Teacher): Generates explanations grounded in quiz
 */

import { getGeminiModel } from '@/lib/gemini';
import { buildPromptA, buildPromptB, buildPromptC } from './prompts';
import { parsePipeline, extractJsonBlock, ParseResult } from './parser';
import {
    PipelineInput,
    PipelineConfig,
    PipelineResult,
    RawPipelineOutputs,
    Diagnostics,
    DiagnosticWarning,
    DEFAULT_PIPELINE_CONFIG,
    CourseMeta,
    QuizOutput
} from './types';

// =============================================================================
// STAGE RUNNERS
// =============================================================================

interface StageResult {
    success: boolean;
    output: string;
    durationMs: number;
    error?: string;
}

/**
 * Run a single prompt stage with retries
 */
async function runStage(
    prompt: string,
    config: PipelineConfig,
    stageName: string
): Promise<StageResult> {
    const startTime = Date.now();
    let lastError = '';

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            const model = getGeminiModel();

            const result = await model.generateContent(prompt);

            const response = await result.response;
            const text = response.text();

            if (!text || text.length < 100) {
                throw new Error('Empty or too short response from model');
            }

            return {
                success: true,
                output: text,
                durationMs: Date.now() - startTime
            };
        } catch (error: any) {
            lastError = error.message || 'Unknown error';
            console.error(`Stage ${stageName} attempt ${attempt} failed:`, lastError);

            // Handle rate limits
            if (error.status === 429 || lastError.includes('429')) {
                const waitMs = 10000 * attempt; // Exponential backoff
                console.log(`Rate limited, waiting ${waitMs}ms...`);
                await new Promise(r => setTimeout(r, waitMs));
            } else if (attempt < config.maxRetries) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    return {
        success: false,
        output: '',
        durationMs: Date.now() - startTime,
        error: lastError
    };
}

/**
 * Run Prompt A (Architect)
 */
export async function runPromptA(
    contextForGeneration: string,
    metadata: PipelineInput['metadata'],
    config: PipelineConfig = DEFAULT_PIPELINE_CONFIG
): Promise<StageResult> {
    const prompt = buildPromptA(contextForGeneration, metadata, config.promptVersion);
    return runStage(prompt, config, 'A');
}

/**
 * Run Prompt B (Inspector)
 */
export async function runPromptB(
    courseMarkdown: string,
    courseMeta: CourseMeta,
    numQuestions: number = 20,
    config: PipelineConfig = DEFAULT_PIPELINE_CONFIG
): Promise<StageResult> {
    const courseMetaJson = JSON.stringify(courseMeta, null, 2);
    const prompt = buildPromptB(courseMarkdown, courseMetaJson, numQuestions, config.promptVersion);
    return runStage(prompt, config, 'B');
}

/**
 * Run Prompt C (Teacher)
 */
export async function runPromptC(
    courseMarkdown: string,
    quiz: QuizOutput,
    config: PipelineConfig = DEFAULT_PIPELINE_CONFIG
): Promise<StageResult> {
    const quizJson = JSON.stringify(quiz, null, 2);
    const prompt = buildPromptC(courseMarkdown, quizJson, config.promptVersion);
    return runStage(prompt, config, 'C');
}

// =============================================================================
// FULL PIPELINE
// =============================================================================

export interface FullPipelineResult {
    success: boolean;
    result: PipelineResult | null;
    rawOutputs: RawPipelineOutputs;
    stageErrors: {
        A?: string;
        B?: string;
        C?: string;
    };
}

/**
 * Run the full pipeline: A → B → C → Parser
 */
export async function runFullPipeline(
    input: PipelineInput
): Promise<FullPipelineResult> {
    const config: PipelineConfig = {
        ...DEFAULT_PIPELINE_CONFIG,
        ...input.config
    };

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startTime = new Date().toISOString();

    const rawOutputs: RawPipelineOutputs = {
        runId,
        timestamp: startTime,
        promptA: { input: '', output: '', durationMs: 0 },
        promptB: { input: '', output: '', durationMs: 0 },
        promptC: { input: '', output: '', durationMs: 0 }
    };

    const stageErrors: { A?: string; B?: string; C?: string } = {};

    // Prepare context from documents
    const contextForGeneration = input.documents
        .map(doc => `--- DOCUMENT: ${doc.name} ---\n${doc.content}\n--- END DOCUMENT ---`)
        .join('\n\n');

    // =========================================================================
    // STAGE A: Architect
    // =========================================================================
    console.log('Running Pipeline Stage A (Architect)...');
    rawOutputs.promptA.input = contextForGeneration.substring(0, 1000) + '...';

    const stageAResult = await runPromptA(contextForGeneration, input.metadata, config);
    rawOutputs.promptA.output = stageAResult.output;
    rawOutputs.promptA.durationMs = stageAResult.durationMs;

    if (!stageAResult.success) {
        stageErrors.A = stageAResult.error;
        return {
            success: false,
            result: null,
            rawOutputs,
            stageErrors
        };
    }

    // Parse Stage A to extract courseMeta for Stage B
    const courseMarkdown = stageAResult.output;
    const courseMetaExtract = extractJsonBlock(stageAResult.output);

    let courseMeta: CourseMeta | null = null;
    if (courseMetaExtract.json) {
        try {
            courseMeta = JSON.parse(courseMetaExtract.json);
        } catch (e) {
            stageErrors.A = 'Failed to parse courseMeta JSON from Stage A';
            return { success: false, result: null, rawOutputs, stageErrors };
        }
    } else {
        stageErrors.A = 'No courseMeta JSON found in Stage A output';
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    if (!courseMeta) {
        stageErrors.A = 'CourseMeta is null';
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    // =========================================================================
    // STAGE B: Inspector
    // =========================================================================
    console.log('Running Pipeline Stage B (Inspector)...');

    // Determine question count based on module count
    const numQuestions = Math.max(15, Math.min(25, (courseMeta.modules?.length || 5) * 4));

    const stageBResult = await runPromptB(
        courseMarkdown,
        courseMeta,
        numQuestions,
        config
    );
    rawOutputs.promptB.output = stageBResult.output;
    rawOutputs.promptB.durationMs = stageBResult.durationMs;

    if (!stageBResult.success) {
        stageErrors.B = stageBResult.error;
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    // Parse Stage B to extract quiz for Stage C
    const quizExtract = extractJsonBlock(stageBResult.output);
    let quiz: QuizOutput | null = null;

    if (quizExtract.json) {
        try {
            quiz = JSON.parse(quizExtract.json);
        } catch (e) {
            stageErrors.B = 'Failed to parse quiz JSON from Stage B';
            return { success: false, result: null, rawOutputs, stageErrors };
        }
    } else {
        stageErrors.B = 'No quiz JSON found in Stage B output';
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    if (!quiz) {
        stageErrors.B = 'Quiz is null';
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    // =========================================================================
    // STAGE C: Teacher
    // =========================================================================
    console.log('Running Pipeline Stage C (Teacher)...');

    const stageCResult = await runPromptC(courseMarkdown, quiz, config);
    rawOutputs.promptC.output = stageCResult.output;
    rawOutputs.promptC.durationMs = stageCResult.durationMs;

    if (!stageCResult.success) {
        stageErrors.C = stageCResult.error;
        return { success: false, result: null, rawOutputs, stageErrors };
    }

    // =========================================================================
    // PARSER: Validate and finalize
    // =========================================================================
    console.log('Running Parser validation...');

    const parseResult: ParseResult = parsePipeline(
        stageAResult.output,
        stageBResult.output,
        stageCResult.output,
        config
    );

    // Build diagnostics
    const diagnostics: Diagnostics = {
        pipelineVersion: config.promptVersion,
        runId,
        startedAt: startTime,
        completedAt: new Date().toISOString(),
        stages: {
            A: {
                success: stageAResult.success,
                durationMs: stageAResult.durationMs,
                rawCharCount: stageAResult.output.length
            },
            B: {
                success: stageBResult.success,
                durationMs: stageBResult.durationMs,
                rawCharCount: stageBResult.output.length
            },
            C: {
                success: stageCResult.success,
                durationMs: stageCResult.durationMs,
                rawCharCount: stageCResult.output.length
            }
        },
        validation: {
            courseMetaValid: !!parseResult.courseMeta,
            quizValid: !!parseResult.quiz,
            explanationsValid: !!parseResult.explanations,
            crossLinksValid: parseResult.errors.filter(e =>
                e.code.includes('INVALID_MODULE_REF') ||
                e.code.includes('INVALID_OBJECTIVE_REF') ||
                e.code.includes('INVALID_QUESTION_REF')
            ).length === 0
        },
        warnings: parseResult.warnings,
        errors: parseResult.errors,
        coverage: calculateCoverage(parseResult)
    };

    if (!parseResult.success) {
        return {
            success: false,
            result: {
                success: false,
                courseMarkdown: parseResult.courseMarkdown || '',
                courseMeta: parseResult.courseMeta || ({} as CourseMeta),
                quiz: parseResult.quiz || ({ meta: {}, questions: [] } as unknown as QuizOutput),
                explanations: parseResult.explanations || { promptVersion: '', explanations: [] },
                diagnostics
            },
            rawOutputs,
            stageErrors
        };
    }

    return {
        success: true,
        result: {
            success: true,
            courseMarkdown: parseResult.courseMarkdown!,
            courseMeta: parseResult.courseMeta!,
            quiz: parseResult.quiz!,
            explanations: parseResult.explanations!,
            diagnostics
        },
        rawOutputs,
        stageErrors
    };
}

/**
 * Calculate coverage statistics
 */
function calculateCoverage(parseResult: ParseResult): Diagnostics['coverage'] {
    const coverage: Diagnostics['coverage'] = {
        modulesWithQuestions: 0,
        modulesWithoutQuestions: [],
        objectivesWithQuestions: 0,
        objectivesWithoutQuestions: [],
        correctAnswerDistribution: { 0: 0, 1: 0, 2: 0, 3: 0 }
    };

    if (!parseResult.quiz || !parseResult.courseMeta) {
        return coverage;
    }

    // Module coverage
    const modulesWithQ = new Set(parseResult.quiz.questions.map(q => q.moduleId));
    coverage.modulesWithQuestions = modulesWithQ.size;
    coverage.modulesWithoutQuestions = parseResult.courseMeta.modules
        .filter(m => !modulesWithQ.has(m.moduleId))
        .map(m => m.moduleId);

    // Objective coverage
    const objectivesWithQ = new Set(parseResult.quiz.questions.map(q => q.objectiveId));
    coverage.objectivesWithQuestions = objectivesWithQ.size;
    coverage.objectivesWithoutQuestions = (parseResult.courseMeta.learningObjectives || [])
        .filter(o => !objectivesWithQ.has(o.id))
        .map(o => o.id);

    // Correct answer distribution
    for (const q of parseResult.quiz.questions) {
        const answer = q.correctAnswer;
        if (answer >= 0 && answer <= 3) {
            coverage.correctAnswerDistribution[answer]++;
        }
    }

    return coverage;
}

// =============================================================================
// REGENERATION HELPERS
// =============================================================================

/**
 * Regenerate only Stage A
 */
export async function regenerateStageA(
    input: PipelineInput
): Promise<StageResult> {
    const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...input.config };
    const context = input.documents
        .map(doc => `--- DOCUMENT: ${doc.name} ---\n${doc.content}\n--- END DOCUMENT ---`)
        .join('\n\n');
    return runPromptA(context, input.metadata, config);
}

/**
 * Regenerate only Stage B (requires valid Stage A output)
 */
export async function regenerateStageB(
    courseMarkdown: string,
    courseMeta: CourseMeta,
    numQuestions: number = 20,
    config?: Partial<PipelineConfig>
): Promise<StageResult> {
    const fullConfig: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    return runPromptB(courseMarkdown, courseMeta, numQuestions, fullConfig);
}

/**
 * Regenerate only Stage C (requires valid Stage B output)
 */
export async function regenerateStageC(
    courseMarkdown: string,
    quiz: QuizOutput,
    config?: Partial<PipelineConfig>
): Promise<StageResult> {
    const fullConfig: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    return runPromptC(courseMarkdown, quiz, fullConfig);
}
