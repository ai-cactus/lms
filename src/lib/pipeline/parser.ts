/**
 * LMS Pipeline Parser
 * 
 * Gatekeeper that:
 * - Extracts JSON blocks from LLM output
 * - Repairs common JSON defects
 * - Validates A↔B↔C consistency
 * - Generates diagnostics
 */

import {
    CourseMeta,
    QuizOutput,
    QuizQuestion,
    ExplanationsOutput,
    DiagnosticWarning,
    PipelineConfig,
    DEFAULT_PIPELINE_CONFIG
} from './types';

// =============================================================================
// JSON EXTRACTION
// =============================================================================

/**
 * Extract JSON block from text (handles markdown fenced blocks)
 */
export function extractJsonBlock(text: string): { json: string | null; startIndex: number; endIndex: number } {
    // Try to find ```json ... ``` block
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
    const match = text.match(jsonBlockRegex);

    if (match) {
        return {
            json: match[1].trim(),
            startIndex: match.index || 0,
            endIndex: (match.index || 0) + match[0].length
        };
    }

    // Try to find ``` ... ``` block that looks like JSON
    const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
    const codeMatch = text.match(codeBlockRegex);

    if (codeMatch) {
        const content = codeMatch[1].trim();
        if (content.startsWith('{') || content.startsWith('[')) {
            return {
                json: content,
                startIndex: codeMatch.index || 0,
                endIndex: (codeMatch.index || 0) + codeMatch[0].length
            };
        }
    }

    // Try to find raw JSON object/array
    const jsonStartRegex = /(\{[\s\S]*\}|\[[\s\S]*\])/;
    const rawMatch = text.match(jsonStartRegex);

    if (rawMatch) {
        return {
            json: rawMatch[1].trim(),
            startIndex: rawMatch.index || 0,
            endIndex: (rawMatch.index || 0) + rawMatch[0].length
        };
    }

    return { json: null, startIndex: -1, endIndex: -1 };
}

/**
 * Extract markdown content (everything before the JSON block)
 */
export function extractMarkdownContent(text: string): string {
    const { startIndex } = extractJsonBlock(text);

    if (startIndex > 0) {
        return text.substring(0, startIndex).trim();
    }

    // No JSON block found, return all text
    return text.trim();
}

// =============================================================================
// JSON REPAIR
// =============================================================================

/**
 * Attempt to repair common JSON defects
 */
export function repairJson(text: string): { repaired: string; wasRepaired: boolean; repairs: string[] } {
    const repairs: string[] = [];
    let repaired = text;

    // Remove trailing commas before } or ]
    const trailingCommaRegex = /,(\s*[}\]])/g;
    if (trailingCommaRegex.test(repaired)) {
        repaired = repaired.replace(trailingCommaRegex, '$1');
        repairs.push('Removed trailing commas');
    }

    // Fix unescaped newlines in strings
    // This is tricky - only fix if inside quotes
    const unescapedNewlines = repaired.match(/"[^"]*\n[^"]*"/g);
    if (unescapedNewlines) {
        repaired = repaired.replace(/"([^"]*)\n([^"]*)"/g, '"$1\\n$2"');
        repairs.push('Escaped newlines in strings');
    }

    // Fix missing commas between objects } { -> }, {
    // We strictly look for closing brace, whitespace, opening brace
    const missingCommaRegex = /}\s*{/g;
    if (missingCommaRegex.test(repaired)) {
        repaired = repaired.replace(missingCommaRegex, '}, {');
        repairs.push('Added missing commas between objects');
    }

    // Try to close unclosed brackets (truncation repair)
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/]/g) || []).length;

    if (openBraces > closeBraces) {
        // Check if we're inside a string (unsafe to repair)
        const lastQuote = repaired.lastIndexOf('"');
        const quoteCount = (repaired.match(/"/g) || []).length;

        if (quoteCount % 2 === 0) {
            // Even number of quotes, safe to close
            const missing = openBraces - closeBraces;
            repaired = repaired.trimEnd();

            // Remove trailing incomplete content
            repaired = repaired.replace(/,\s*$/, '');
            repaired = repaired.replace(/:\s*$/, ': null');

            for (let i = 0; i < missing; i++) {
                // Check if we need to close an array first
                if (openBrackets > closeBrackets + i) {
                    repaired += ']';
                }
                repaired += '}';
            }
            repairs.push(`Added ${missing} closing brace(s)`);
        }
    }

    if (openBrackets > closeBrackets) {
        const missing = openBrackets - closeBrackets;
        for (let i = 0; i < missing; i++) {
            repaired += ']';
        }
        repairs.push(`Added ${missing} closing bracket(s)`);
    }

    return {
        repaired,
        wasRepaired: repairs.length > 0,
        repairs
    };
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

/**
 * Validate courseMeta structure
 */
export function validateCourseMeta(meta: any, warnings: DiagnosticWarning[]): CourseMeta | null {
    if (!meta || typeof meta !== 'object') {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'INVALID_COURSE_META',
            message: 'courseMeta is not a valid object'
        });
        return null;
    }

    // Required fields
    const required = ['courseTitle', 'modules'];
    for (const field of required) {
        if (!meta[field]) {
            warnings.push({
                stage: 'parser',
                severity: 'error',
                code: 'MISSING_FIELD',
                message: `courseMeta missing required field: ${field}`
            });
        }
    }

    // Validate modules
    if (!Array.isArray(meta.modules)) {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'INVALID_MODULES',
            message: 'courseMeta.modules must be an array'
        });
        return null;
    }

    for (const mod of meta.modules) {
        if (!mod.moduleId) {
            warnings.push({
                stage: 'parser',
                severity: 'error',
                code: 'MISSING_MODULE_ID',
                message: `Module missing moduleId: ${JSON.stringify(mod)}`
            });
        }
    }

    // Validate learning objectives
    if (meta.learningObjectives && !Array.isArray(meta.learningObjectives)) {
        warnings.push({
            stage: 'parser',
            severity: 'warning',
            code: 'INVALID_OBJECTIVES',
            message: 'courseMeta.learningObjectives should be an array'
        });
        meta.learningObjectives = [];
    }

    // Auto-fill missing counts
    if (!meta.moduleCount) {
        meta.moduleCount = meta.modules.length;
    }
    if (!meta.objectiveCount) {
        meta.objectiveCount = (meta.learningObjectives || []).length;
    }

    return meta as CourseMeta;
}

/**
 * Validate quiz structure and cross-links to courseMeta
 */
export function validateQuiz(
    quiz: any,
    courseMeta: CourseMeta,
    warnings: DiagnosticWarning[]
): QuizOutput | null {
    if (!quiz || typeof quiz !== 'object') {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'INVALID_QUIZ',
            message: 'Quiz is not a valid object'
        });
        return null;
    }

    // Check for questions array
    if (!quiz.questions || !Array.isArray(quiz.questions)) {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'MISSING_QUESTIONS',
            message: 'Quiz must have a questions array'
        });
        return null;
    }

    const moduleIds = new Set(courseMeta.modules.map(m => m.moduleId));
    const objectiveIds = new Set((courseMeta.learningObjectives || []).map(o => o.id));
    const questionIds = new Set<string>();

    for (const q of quiz.questions) {
        // Check for duplicate question IDs
        if (questionIds.has(q.id)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'DUPLICATE_QUESTION_ID',
                message: `Duplicate question ID: ${q.id}`
            });
        }
        questionIds.add(q.id);

        // Validate moduleId cross-link
        if (q.moduleId && !moduleIds.has(q.moduleId)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'INVALID_MODULE_REF',
                message: `Question ${q.id} references non-existent module: ${q.moduleId}`,
                details: { questionId: q.id, moduleId: q.moduleId }
            });
        }

        // Validate objectiveId cross-link
        if (q.objectiveId && objectiveIds.size > 0 && !objectiveIds.has(q.objectiveId)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'INVALID_OBJECTIVE_REF',
                message: `Question ${q.id} references non-existent objective: ${q.objectiveId}`,
                details: { questionId: q.id, objectiveId: q.objectiveId }
            });
        }

        // Validate options
        if (!Array.isArray(q.options) || q.options.length !== 4) {
            warnings.push({
                stage: 'parser',
                severity: 'error',
                code: 'INVALID_OPTIONS',
                message: `Question ${q.id} must have exactly 4 options`
            });
        }

        // Validate correctAnswer
        if (typeof q.correctAnswer !== 'number' || q.correctAnswer < 0 || q.correctAnswer > 3) {
            warnings.push({
                stage: 'parser',
                severity: 'error',
                code: 'INVALID_CORRECT_ANSWER',
                message: `Question ${q.id} has invalid correctAnswer: ${q.correctAnswer}`
            });
        }

        // Validate difficulty
        const validDifficulties = ['recall', 'application', 'judgment'];
        if (q.difficulty && !validDifficulties.includes(q.difficulty)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'INVALID_DIFFICULTY',
                message: `Question ${q.id} has invalid difficulty: ${q.difficulty}`
            });
        }
    }

    // Check module coverage
    const modulesWithQuestions = new Set(quiz.questions.map((q: QuizQuestion) => q.moduleId));
    for (const mod of courseMeta.modules) {
        if (!modulesWithQuestions.has(mod.moduleId)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'UNCOVERED_MODULE',
                message: `Module has no questions: ${mod.moduleId} (${mod.moduleTitle})`
            });
        }
    }

    return quiz as QuizOutput;
}

/**
 * Validate explanations structure and cross-links to quiz
 */
export function validateExplanations(
    explanations: any,
    quiz: QuizOutput,
    warnings: DiagnosticWarning[]
): ExplanationsOutput | null {
    if (!explanations || typeof explanations !== 'object') {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'INVALID_EXPLANATIONS',
            message: 'Explanations is not a valid object'
        });
        return null;
    }

    if (!explanations.explanations || !Array.isArray(explanations.explanations)) {
        warnings.push({
            stage: 'parser',
            severity: 'error',
            code: 'MISSING_EXPLANATIONS_ARRAY',
            message: 'Explanations must have an explanations array'
        });
        return null;
    }

    const questionIds = new Set(quiz.questions.map(q => q.id));
    const explainedIds = new Set<string>();

    for (const exp of explanations.explanations) {
        // Validate questionId cross-link
        if (!questionIds.has(exp.questionId)) {
            warnings.push({
                stage: 'parser',
                severity: 'error',
                code: 'INVALID_QUESTION_REF',
                message: `Explanation references non-existent question: ${exp.questionId}`
            });
        }
        explainedIds.add(exp.questionId);

        // Validate correctExplanation
        if (!exp.correctExplanation) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'MISSING_CORRECT_EXPLANATION',
                message: `Missing correctExplanation for question: ${exp.questionId}`
            });
        }

        // Validate incorrectOptions
        if (!exp.incorrectOptions || typeof exp.incorrectOptions !== 'object') {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'MISSING_INCORRECT_OPTIONS',
                message: `Missing incorrectOptions for question: ${exp.questionId}`
            });
        }
    }

    // Check for missing explanations
    for (const q of quiz.questions) {
        if (!explainedIds.has(q.id)) {
            warnings.push({
                stage: 'parser',
                severity: 'warning',
                code: 'MISSING_EXPLANATION',
                message: `No explanation for question: ${q.id}`
            });
        }
    }

    return explanations as ExplanationsOutput;
}

// =============================================================================
// FULL PIPELINE PARSER
// =============================================================================

export interface ParseResult {
    success: boolean;
    courseMarkdown: string | null;
    courseMeta: CourseMeta | null;
    quiz: QuizOutput | null;
    explanations: ExplanationsOutput | null;
    warnings: DiagnosticWarning[];
    errors: DiagnosticWarning[];
}

/**
 * Parse all three pipeline outputs
 */
export function parsePipeline(
    promptAOutput: string,
    promptBOutput: string,
    promptCOutput: string,
    config: PipelineConfig = DEFAULT_PIPELINE_CONFIG
): ParseResult {
    const warnings: DiagnosticWarning[] = [];
    const errors: DiagnosticWarning[] = [];

    // Parse Prompt A output
    const courseMarkdown = extractMarkdownContent(promptAOutput);
    const courseMetaExtract = extractJsonBlock(promptAOutput);

    let courseMetaRaw: any = null;
    if (courseMetaExtract.json) {
        try {
            let jsonToParse = courseMetaExtract.json;

            if (config.repair) {
                const repairResult = repairJson(jsonToParse);
                if (repairResult.wasRepaired) {
                    warnings.push({
                        stage: 'parser',
                        severity: 'warning',
                        code: 'JSON_REPAIRED',
                        message: `Prompt A JSON was repaired: ${repairResult.repairs.join(', ')}`
                    });
                    jsonToParse = repairResult.repaired;
                }
            }

            courseMetaRaw = JSON.parse(jsonToParse);
        } catch (e: any) {
            errors.push({
                stage: 'A',
                severity: 'error',
                code: 'JSON_PARSE_ERROR',
                message: `Failed to parse courseMeta JSON: ${e.message}`
            });
        }
    } else {
        errors.push({
            stage: 'A',
            severity: 'error',
            code: 'NO_JSON_BLOCK',
            message: 'No JSON block found in Prompt A output'
        });
    }

    const courseMeta = courseMetaRaw ? validateCourseMeta(courseMetaRaw, warnings) : null;

    // Parse Prompt B output
    const quizExtract = extractJsonBlock(promptBOutput);
    let quizRaw: any = null;

    if (quizExtract.json) {
        try {
            let jsonToParse = quizExtract.json;

            if (config.repair) {
                const repairResult = repairJson(jsonToParse);
                if (repairResult.wasRepaired) {
                    warnings.push({
                        stage: 'parser',
                        severity: 'warning',
                        code: 'JSON_REPAIRED',
                        message: `Prompt B JSON was repaired: ${repairResult.repairs.join(', ')}`
                    });
                    jsonToParse = repairResult.repaired;
                }
            }

            quizRaw = JSON.parse(jsonToParse);
        } catch (e: any) {
            errors.push({
                stage: 'B',
                severity: 'error',
                code: 'JSON_PARSE_ERROR',
                message: `Failed to parse quiz JSON: ${e.message}`
            });
        }
    } else {
        errors.push({
            stage: 'B',
            severity: 'error',
            code: 'NO_JSON_BLOCK',
            message: 'No JSON block found in Prompt B output'
        });
    }

    const quiz = (quizRaw && courseMeta) ? validateQuiz(quizRaw, courseMeta, warnings) : null;

    // Parse Prompt C output
    const explanationsExtract = extractJsonBlock(promptCOutput);
    let explanationsRaw: any = null;

    if (explanationsExtract.json) {
        try {
            let jsonToParse = explanationsExtract.json;

            if (config.repair) {
                const repairResult = repairJson(jsonToParse);
                if (repairResult.wasRepaired) {
                    warnings.push({
                        stage: 'parser',
                        severity: 'warning',
                        code: 'JSON_REPAIRED',
                        message: `Prompt C JSON was repaired: ${repairResult.repairs.join(', ')}`
                    });
                    jsonToParse = repairResult.repaired;
                }
            }

            explanationsRaw = JSON.parse(jsonToParse);
        } catch (e: any) {
            errors.push({
                stage: 'C',
                severity: 'error',
                code: 'JSON_PARSE_ERROR',
                message: `Failed to parse explanations JSON: ${e.message}`
            });
        }
    } else {
        errors.push({
            stage: 'C',
            severity: 'error',
            code: 'NO_JSON_BLOCK',
            message: 'No JSON block found in Prompt C output'
        });
    }

    const explanations = (explanationsRaw && quiz)
        ? validateExplanations(explanationsRaw, quiz, warnings)
        : null;

    // Determine success based on strict mode
    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;
    const success = config.strict
        ? !hasErrors && !hasWarnings
        : !hasErrors;

    // Collect all diagnostics
    const allWarnings = warnings.filter(w => w.severity !== 'error');
    const allErrors = [...errors, ...warnings.filter(w => w.severity === 'error')];

    return {
        success,
        courseMarkdown: config.sanitizeCourse ? sanitizeCourseMarkdown(courseMarkdown) : courseMarkdown,
        courseMeta,
        quiz,
        explanations,
        warnings: allWarnings,
        errors: allErrors
    };
}

/**
 * Remove reviewer notes and internal comments from course markdown
 */
function sanitizeCourseMarkdown(markdown: string): string {
    // Remove <!-- comments -->
    let sanitized = markdown.replace(/<!--[\s\S]*?-->/g, '');

    // Remove lines starting with [REVIEWER NOTE] or similar
    sanitized = sanitized.replace(/^\[REVIEWER.*?\].*$/gm, '');
    sanitized = sanitized.replace(/^\[INTERNAL.*?\].*$/gm, '');
    sanitized = sanitized.replace(/^\[NOTE:.*?\].*$/gm, '');

    // Clean up extra blank lines
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized.trim();
}
