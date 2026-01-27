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

        const result = await runPromptB(courseContent, meta, numQuestions, config);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || 'Failed to generate quiz' },
                { status: 500 }
            );
        }

        // Parse quiz JSON from output
        const extracted = extractJsonBlock(result.output);
        let quizJsonString = extracted.json;

        if (!quizJsonString) {
            console.log('Quiz Generation Raw Output:', result.output);

            // Fallback: try to repair and parse
            // repairJson always returns a string in .repaired (it defaults to original if no repairs)
            // But we should check if it looks like JSON if extraction failed.
            // Actually repairJson returns { repaired, wasRepaired, repairs }

            // If extraction failed, maybe repairJson can make it extractable? 
            // Or maybe repairJson is meant to run ON the extracted JSON?
            // "Attempt to repair common JSON defects" usually runs on the JSON string.
            // If we don't have a JSON block, repairJson on the whole text might not work if it contains markdown.

            // Let's try to repair the whole output and then extract again? 
            // Or assume the whole output is meant to be JSON?

            // For now, let's just error if we can't extract, unless repair finds something.
            // Actually, let's trust the repair if it claims success, but parser.ts says: "Attempt to repair common JSON defects"

            if (result.output.trim().startsWith('{') || result.output.trim().startsWith('[')) {
                const repaired = repairJson(result.output);
                quizJsonString = repaired.repaired;
            } else {
                return NextResponse.json(
                    { error: 'Failed to parse quiz JSON from response', rawOutput: result.output },
                    { status: 500 }
                );
            }
        }

        // Parse and validate
        let parsed: any;
        try {
            parsed = JSON.parse(quizJsonString!);
        } catch (parseError) {
            console.warn("Initial JSON parse failed, attempting repair:", parseError);
            const repairResult = repairJson(quizJsonString!);
            try {
                parsed = JSON.parse(repairResult.repaired);
                console.log("JSON successfully repaired");
            } catch (repairError) {
                console.error("JSON repair failed:", repairError);
                return NextResponse.json(
                    {
                        error: 'Failed to parse quiz JSON',
                        details: (repairError as Error).message,
                        rawOutput: result.output
                    },
                    { status: 500 }
                );
            }
        }

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
