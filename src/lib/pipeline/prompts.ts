/**
 * LMS Pipeline Prompts
 * 
 * Three-stage prompt templates:
 * - Prompt A (Architect): Generates course markdown + courseMeta JSON
 * - Prompt B (Inspector): Generates quiz JSON grounded in courseMeta
 * - Prompt C (Teacher): Generates explanations JSON grounded in quiz
 */

import { CourseMetadataInput } from './types';

// =============================================================================
// PROMPT A: THE ARCHITECT
// =============================================================================
// Produces: Course Markdown + courseMeta JSON

export function buildPromptA(
    contextForGeneration: string,
    metadata?: CourseMetadataInput,
    promptVersion: string = 'v1.0'
): string {
    const metadataSection = metadata ? `
COURSE METADATA (Use this to guide course creation):
- Title: ${metadata.title}
${metadata.description ? `- Description: ${metadata.description}` : ''}
${metadata.category ? `- Category: ${metadata.category}` : ''}
${metadata.difficulty ? `- Difficulty Level: ${metadata.difficulty}` : ''}
${metadata.duration ? `- Estimated Duration: ${metadata.duration}` : ''}
${metadata.objectives?.length ? `- Learning Objectives:\n${metadata.objectives.map((obj, i) => `  ${i + 1}. ${obj}`).join('\n')}` : ''}
${metadata.complianceMapping ? `- Compliance Mapping: ${metadata.complianceMapping}` : ''}
` : '';

    const difficultyInstructions = getDifficultyInstructions(metadata?.difficulty);

    return `You are an expert instructional designer creating a training course.

PROMPT VERSION: ${promptVersion}

${metadataSection}

${difficultyInstructions}

YOUR TASK:
Create a comprehensive training course with two outputs:
1. Course content in Markdown format
2. A courseMeta JSON block with metadata

COURSE MARKDOWN REQUIREMENTS:
- Course Title (H1 with single #)${metadata ? ` - USE: "${metadata.title}"` : ''}
- Brief Course Description (2-3 sentences)
- Horizontal rule (---) after description
- Modules using H2 (##) with format: "## Module N: [Title]"
- Add horizontal rule (---) after EVERY module
- MAXIMUM 1000 characters per module (split into Part 1, Part 2 if needed)
- Use **bold** for key terms, bullet points for lists
- Include analogies and real-world examples
- End with a Summary module listing what was learned

WITHIN EACH MODULE:
- Clear introduction to the concept
- Rich explanations with examples
- Avoid lazy bullet lists without context
- Explain "why" not just "what"

COURSEMETA JSON REQUIREMENTS:
After the markdown, output exactly ONE fenced JSON block with this structure:

\`\`\`json
{
  "promptVersion": "${promptVersion}",
  "courseTitle": "Title here",
  "courseDescription": "Description here",
  "moduleCount": 5,
  "objectiveCount": 3,
  "modules": [
    {
      "moduleId": "module-1",
      "moduleNumber": 1,
      "moduleTitle": "Introduction to Topic",
      "sourceRefs": ["Policy ABC: section 1.2", "Handbook: pages 3-5"]
    }
  ],
  "learningObjectives": [
    {
      "id": "LO1",
      "text": "Identify the key principles of...",
      "moduleIds": ["module-1", "module-2"]
    }
  ],
  "generatedAt": "${new Date().toISOString()}",
  "reviewerNotes": "Internal notes about any source inconsistencies (optional)"
}
\`\`\`

CRITICAL:
- moduleId format must be consistent (use "module-N")
- Include sourceRefs per module showing where content came from
- learningObjectives must have unique IDs (LO1, LO2, etc.)
- If sources are contradictory, note it in reviewerNotes only
- Output exactly ONE JSON block at the end

SOURCE DOCUMENTS:
${contextForGeneration}
`;
}

// =============================================================================
// PROMPT B: THE INSPECTOR
// =============================================================================
// Produces: Quiz JSON grounded strictly in Prompt A course content + courseMeta

export function buildPromptB(
    courseMarkdown: string,
    courseMeta: string,
    numQuestions: number = 20,
    promptVersion: string = 'v1.0'
): string {
    return `You are an expert quiz designer creating assessment questions.

PROMPT VERSION: ${promptVersion}

YOUR TASK:
Create exactly ${numQuestions} multiple-choice questions based ONLY on the course content provided.
Each question must be traceable to a specific module and learning objective.

QUESTION REQUIREMENTS:
- Questions must test content that IS in the course (no external knowledge)
- Each question has exactly 4 options
- Exactly 1 correct answer per question
- Distribute difficulty: ~40% recall, ~40% application, ~20% judgment
- Cover all modules and learning objectives proportionally

DIFFICULTY DEFINITIONS:
- recall: Direct memory of facts from the course
- application: Applying concepts to scenarios
- judgment: Evaluating situations or making decisions

OUTPUT FORMAT:
Output exactly ONE fenced JSON block:

\`\`\`json
{
  "meta": {
    "promptVersion": "${promptVersion}",
    "totalQuestions": ${numQuestions},
    "difficultyDistribution": {
      "recall": 8,
      "application": 8,
      "judgment": 4
    },
    "coverageByModule": {
      "module-1": 4,
      "module-2": 3
    },
    "coverageByObjective": {
      "LO1": 5,
      "LO2": 4
    }
  },
  "questions": [
    {
      "id": "q01",
      "questionText": "What is the primary purpose of...?",
      "moduleId": "module-1",
      "objectiveId": "LO1",
      "difficulty": "recall",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0
    }
  ]
}
\`\`\`

CRITICAL VALIDATION:
- moduleId MUST exist in the courseMeta.modules array
- objectiveId MUST exist in the courseMeta.learningObjectives array
- correctAnswer is 0-3 (index of correct option)
- Question IDs must be unique (q01, q02, etc.)
- Do not use quotes inside question text unless necessary

COURSE CONTENT:
${courseMarkdown}

COURSE METADATA:
${courseMeta}
`;
}

// =============================================================================
// PROMPT C: THE TEACHER
// =============================================================================
// Produces: Explanations JSON grounded strictly in quiz + course

export function buildPromptC(
    courseMarkdown: string,
    quizJson: string,
    promptVersion: string = 'v1.0'
): string {
    return `You are an expert educator creating learning explanations.

PROMPT VERSION: ${promptVersion}

YOUR TASK:
For each quiz question, create:
1. An explanation of why the correct answer is correct
2. Explanations for why each incorrect option is wrong

REQUIREMENTS:
- Explanations must reference concepts FROM THE COURSE ONLY
- Do NOT introduce new facts or information
- Keep explanations concise but educational (1-3 sentences each)
- Help learners understand their mistakes

OUTPUT FORMAT:
Output exactly ONE fenced JSON block:

\`\`\`json
{
  "promptVersion": "${promptVersion}",
  "explanations": [
    {
      "questionId": "q01",
      "correctExplanation": "Option A is correct because the course states that...",
      "incorrectOptions": {
        "1": "This is incorrect because the policy actually requires...",
        "2": "This contradicts what was taught about...",
        "3": "While this seems reasonable, the course specifically mentions..."
      }
    }
  ]
}
\`\`\`

CRITICAL:
- questionId MUST match a question ID from the quiz
- incorrectOptions keys are the INDICES (0-3) of wrong answers, excluding the correct one
- If correct answer is 0, incorrectOptions has keys "1", "2", "3"
- If correct answer is 2, incorrectOptions has keys "0", "1", "3"
- Every question must have an explanation

COURSE CONTENT:
${courseMarkdown}

QUIZ QUESTIONS:
${quizJson}
`;
}

// =============================================================================
// HELPER: Difficulty Instructions
// =============================================================================

function getDifficultyInstructions(difficulty?: string): string {
    switch (difficulty) {
        case 'Beginner':
            return `
DIFFICULTY LEVEL: BEGINNER
- Use plain, everyday language
- Avoid jargon; explain technical terms immediately
- Use simple analogies from daily life
- Break concepts into small pieces
- Provide step-by-step instructions
- Focus on practical "how-to"
- Use encouraging, supportive tone
`;
        case 'Moderate':
            return `
DIFFICULTY LEVEL: MODERATE
- Use professional terminology with explanations
- Provide both conceptual understanding AND practical application
- Include industry-standard terminology
- Explain the "why" behind processes
- Assume basic familiarity but not expertise
`;
        case 'Advanced':
            return `
DIFFICULTY LEVEL: ADVANCED
- Use precise technical terminology
- Provide in-depth theoretical foundations
- Include technical specifications and best practices
- Reference industry frameworks and compliance requirements
- Explain complex mechanisms and edge cases
- Assume professional expertise
`;
        default:
            return '';
    }
}

// =============================================================================
// EXPORT ALL
// =============================================================================

export const PROMPTS = {
    buildPromptA,
    buildPromptB,
    buildPromptC
};
