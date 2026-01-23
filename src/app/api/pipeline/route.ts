/**
 * Full Pipeline API Endpoint
 * 
 * POST /api/pipeline
 * Runs the complete A→B→C pipeline and returns all artifacts
 */

import { NextRequest, NextResponse } from 'next/server';
import { runFullPipeline, PipelineInput, FullPipelineResult } from '@/lib/pipeline';
import { extractTextFromFile } from '@/lib/file-processing';

interface UploadedFile {
    name: string;
    type?: string;
    data?: string;
    content?: string;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { files, metadata, config } = body;

        if (!files || files.length === 0) {
            return NextResponse.json(
                { error: 'No files provided' },
                { status: 400 }
            );
        }

        // Process files to extract text
        const documents: PipelineInput['documents'] = [];

        for (const file of files as UploadedFile[]) {
            try {
                let content = file.content;

                // If content is not provided directly, extract from file data
                if (!content && file.data) {
                    content = await extractTextFromFile(file);
                }

                if (content && content.trim().length > 50) {
                    documents.push({
                        name: file.name,
                        content: content,
                        type: file.type
                    });
                }
            } catch (e: any) {
                console.error(`Failed to process file ${file.name}:`, e);
            }
        }

        if (documents.length === 0) {
            return NextResponse.json(
                { error: 'No readable content found in uploaded files' },
                { status: 400 }
            );
        }

        // Run the full pipeline
        const input: PipelineInput = {
            documents,
            metadata: metadata || undefined,
            config: config || undefined
        };

        console.log(`Starting pipeline with ${documents.length} documents`);
        const result: FullPipelineResult = await runFullPipeline(input);

        if (!result.success) {
            const errorMessage = result.stageErrors.A
                || result.stageErrors.B
                || result.stageErrors.C
                || 'Pipeline failed';

            return NextResponse.json({
                success: false,
                error: errorMessage,
                stageErrors: result.stageErrors,
                rawOutputs: result.rawOutputs,
                partialResult: result.result
            }, { status: 500 });
        }

        // Return successful result
        return NextResponse.json({
            success: true,
            courseMarkdown: result.result!.courseMarkdown,
            courseMeta: result.result!.courseMeta,
            quiz: result.result!.quiz,
            explanations: result.result!.explanations,
            diagnostics: result.result!.diagnostics,
            rawOutputs: result.rawOutputs
        });

    } catch (error: any) {
        console.error('Pipeline error:', error);

        if (error.status === 429 || error.message?.includes('429')) {
            return NextResponse.json(
                { error: 'AI service is busy. Please try again in a few minutes.' },
                { status: 429 }
            );
        }

        return NextResponse.json(
            { error: error.message || 'Pipeline failed' },
            { status: 500 }
        );
    }
}
