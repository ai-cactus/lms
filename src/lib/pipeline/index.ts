/**
 * LMS Pipeline Library
 * 
 * 3-stage prompt pipeline for course generation:
 * A (Architect) → B (Inspector) → C (Teacher) → Parser
 */

// Types
export * from './types';

// Prompts
export { buildPromptA, buildPromptB, buildPromptC, PROMPTS } from './prompts';

// Parser
export {
    extractJsonBlock,
    extractMarkdownContent,
    repairJson,
    validateCourseMeta,
    validateQuiz,
    validateExplanations,
    parsePipeline,
    type ParseResult
} from './parser';

// Runner
export {
    runPromptA,
    runPromptB,
    runPromptC,
    runFullPipeline,
    regenerateStageA,
    regenerateStageB,
    regenerateStageC,
    type FullPipelineResult
} from './runner';
