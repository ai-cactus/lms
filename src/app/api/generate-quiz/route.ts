import { NextRequest, NextResponse } from "next/server";
import {
    runPromptB,
    extractJsonBlock,
    repairJson,
    DEFAULT_PIPELINE_CONFIG,
    CourseMeta,
    QuizQuestion
} from "@/lib/pipeline";

export async function POST(req: NextRequest) {
    try {
        const {
            courseContent,
            courseMeta,
            numQuestions = 15,
            difficulty = 'Moderate'
        } = await req.json();

        if (!courseContent) {
            return NextResponse.json({ error: "No course content provided" }, { status: 400 });
        }

        // Build courseMeta from input or create minimal version
        const meta: CourseMeta = courseMeta || {
            modules: [{
                id: 'mod1',
                title: 'Course Content',
                objectives: ['Understand key concepts'],
                keyTerms: [],
                conceptCount: Math.ceil(numQuestions / 3) // Estimate concepts from question count
            }],
            difficulty: difficulty.toLowerCase() as 'beginner' | 'moderate' | 'advanced',
            estimatedDuration: 30,
            prerequisites: [],
            targetAudience: 'General learners'
        };

        // Override config for legacy compatibility
        const config = {
            ...DEFAULT_PIPELINE_CONFIG,
            quizQuestionsPerModule: Math.ceil(numQuestions / (meta.modules?.length || 1))
        };

        console.log('Running Prompt B (Inspector) for quiz generation...');

        const result = await runPromptB(courseContent, meta, config);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || 'Failed to generate quiz' },
                { status: 500 }
            );
        }

        // Parse quiz JSON from output
        let quizJson = extractJsonBlock(result.output);

        if (!quizJson) {
            // Fallback: try to repair and parse
            const repaired = repairJson(result.output);
            if (repaired) {
                quizJson = repaired;
            } else {
                return NextResponse.json(
                    { error: 'Failed to parse quiz JSON from response', rawOutput: result.output },
                    { status: 500 }
                );
            }
        }

        // Parse and validate
        const parsed = JSON.parse(quizJson);

        // Handle both array format (legacy) and object format (new pipeline)
        let questions: QuizQuestion[];
        if (Array.isArray(parsed)) {
            questions = parsed;
        } else if (parsed.questions) {
            questions = parsed.questions;
        } else {
            return NextResponse.json(
                { error: 'Invalid quiz format', rawOutput: result.output },
                { status: 500 }
            );
        }

        return NextResponse.json({
            questions,
            durationMs: result.durationMs,
            rawOutput: result.output
        });

    } catch (error: any) {
        console.error("Error generating quiz:", error);

        if (error.status === 429 || error.message?.includes('429')) {
            return NextResponse.json(
                { error: 'AI service is busy. Please try again in a few minutes.' },
                { status: 429 }
            );
        }

        return NextResponse.json(
            { error: error.message || "Failed to generate quiz" },
            { status: 500 }
        );
    }
}
