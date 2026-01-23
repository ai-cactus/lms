/**
 * Generate Explanations API Endpoint (Prompt C)
 * 
 * POST /api/generate-explanations
 * Takes course markdown and quiz, returns explanations JSON
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPromptC, parsePipeline, QuizOutput, DEFAULT_PIPELINE_CONFIG } from '@/lib/pipeline';

export async function POST(req: NextRequest) {
    try {
        const { courseMarkdown, quiz } = await req.json();

        if (!courseMarkdown) {
            return NextResponse.json(
                { error: 'No course markdown provided' },
                { status: 400 }
            );
        }

        if (!quiz || !quiz.questions) {
            return NextResponse.json(
                { error: 'No quiz provided' },
                { status: 400 }
            );
        }

        console.log('Running Prompt C (Teacher) for explanations...');

        const result = await runPromptC(
            courseMarkdown,
            quiz as QuizOutput,
            DEFAULT_PIPELINE_CONFIG
        );

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || 'Failed to generate explanations' },
                { status: 500 }
            );
        }

        // Parse the output to extract explanations JSON
        // Use a minimal parse just for Stage C
        const parseResult = parsePipeline(
            '# Placeholder\n```json\n{"modules":[]}\n```', // Minimal A
            JSON.stringify(quiz), // B is just the quiz
            result.output, // C is what we care about
            DEFAULT_PIPELINE_CONFIG
        );

        if (!parseResult.explanations) {
            return NextResponse.json({
                success: false,
                error: 'Failed to parse explanations from response',
                rawOutput: result.output,
                warnings: parseResult.warnings,
                errors: parseResult.errors
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            explanations: parseResult.explanations,
            rawOutput: result.output,
            durationMs: result.durationMs
        });

    } catch (error: any) {
        console.error('Generate explanations error:', error);

        if (error.status === 429 || error.message?.includes('429')) {
            return NextResponse.json(
                { error: 'AI service is busy. Please try again.' },
                { status: 429 }
            );
        }

        return NextResponse.json(
            { error: error.message || 'Failed to generate explanations' },
            { status: 500 }
        );
    }
}
