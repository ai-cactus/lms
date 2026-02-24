'use server';

import { z } from 'zod';
import { extractTextFromFile } from '@/lib/file-parser';
import { callVertexAI, truncateToContext } from '@/lib/ai-client';
import { buildPromptA, buildPromptB } from '@/lib/prompts';
import { CourseV3Schema, QuizV3Schema } from '@/lib/prompt-schemas';
import type { CourseV3, QuizV3, QuizDifficulty } from '@/lib/prompt-types';

// Token budget for source content
const MAX_SOURCE_TOKENS = 100000;

// ─── Types ───────────────────────────────────────

interface CourseDataV3 {
    title: string;
    category: string;
    description: string;
    duration: string;
    notesCount: string;
    objectives: string[];
    // Quiz config
    quizTitle: string;
    quizQuestionCount: string;
    quizDifficulty: string;
    quizPassMark: string;
    quizAttempts: string;
}

export interface GeneratedCourseV3 {
    courseJson: CourseV3 | null;
    quizJson: QuizV3 | null;
    sourceText?: string;
    error?: string;
}

// ─── JSON extraction helper ──────────────────────

function extractJsonFromResponse(text: string): string {
    let clean = text.trim();

    // Try to extract from ```json fence first
    const fenceMatch = clean.match(/```json\s*([\s\S]*?)```/);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }

    // Try generic fence
    const genericFenceMatch = clean.match(/```\s*([\s\S]*?)```/);
    if (genericFenceMatch) {
        return genericFenceMatch[1].trim();
    }

    // Try to find the JSON object directly
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return clean.substring(firstBrace, lastBrace + 1);
    }

    return clean;
}

// ─── Stage 1: Course Generation (Prompt A) ───────

async function generateCourseJsonV3(
    sourceText: string,
    documents: { docId: string; label: string; hint?: string }[]
): Promise<{ courseJson: CourseV3; raw: string }> {
    const prompt = buildPromptA({
        sourceTexts: sourceText,
        documents,
    });

    const rawResponse = await callVertexAI(prompt, {
        temperature: 0.4,
        maxOutputTokens: 16384,
    });

    const jsonStr = extractJsonFromResponse(rawResponse);
    const parsed = JSON.parse(jsonStr);

    const result = CourseV3Schema.safeParse(parsed);
    if (!result.success) {
        console.error('[v3.1] Course JSON validation failed:', result.error.format());
        throw new Error(`Course JSON validation failed: ${result.error.issues.map(i => i.message).join('; ')}`);
    }

    return { courseJson: result.data as CourseV3, raw: jsonStr };
}

// ─── Stage 2: Quiz Generation (Prompt B) ─────────

async function generateQuizJsonV3(
    courseJson: string,
    requestedQuestionCount: number,
    quizDifficulty: QuizDifficulty
): Promise<{ quizJson: QuizV3; raw: string }> {
    const prompt = buildPromptB({
        courseJson,
        requestedQuestionCount,
        quizDifficulty,
    });

    const rawResponse = await callVertexAI(prompt, {
        temperature: 0.5,
        maxOutputTokens: 16384,
    });

    const jsonStr = extractJsonFromResponse(rawResponse);
    const parsed = JSON.parse(jsonStr);

    const result = QuizV3Schema.safeParse(parsed);
    if (!result.success) {
        console.error('[v3.1] Quiz JSON validation failed:', result.error.format());
        throw new Error(`Quiz JSON validation failed: ${result.error.issues.map(i => i.message).join('; ')}`);
    }

    return { quizJson: result.data as QuizV3, raw: jsonStr };
}

// ─── Orchestrator (Prompt A → Prompt B) ──────────

export async function generateCourseAndQuizV3(formData: FormData): Promise<GeneratedCourseV3> {
    // Extract data from FormData
    const rawData = formData.get('data');
    if (!rawData || typeof rawData !== 'string') {
        return { courseJson: null, quizJson: null, error: 'Missing course data' };
    }

    const data: CourseDataV3 = JSON.parse(rawData);
    const file = formData.get('file') as File | null;

    let sourceText = '';
    if (file) {
        try {
            console.log(`[v3.1] Processing file: ${file.name} (${file.type})`);
            sourceText = await extractTextFromFile(file);
            console.log(`[v3.1] Extracted ${sourceText.length} characters from file.`);
            sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
        } catch (err: any) {
            console.error('[v3.1] File parsing error:', err);
            return { courseJson: null, quizJson: null, error: `Failed to read document: ${err.message}` };
        }
    }

    // Build document metadata for the prompt
    const documents = [
        { docId: 'doc-1', label: file?.name || 'User-provided document' }
    ];

    const maxAttempts = 3;

    // ── Stage 1: Generate Course JSON ──
    let courseJson: CourseV3;
    let courseRaw: string;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`[v3.1] Course generation attempt ${attempt}/${maxAttempts}`);
            const result = await generateCourseJsonV3(sourceText, documents);
            courseJson = result.courseJson;
            courseRaw = result.raw;

            // Check if sources were insufficient
            if (courseJson.meta.status === 'needs_sources') {
                return {
                    courseJson,
                    quizJson: null,
                    sourceText,
                    error: `Insufficient source material: ${courseJson.meta.gaps.join('; ')}`,
                };
            }

            break; // Success
        } catch (error: any) {
            console.error(`[v3.1] Course attempt ${attempt} failed:`, error.message);
            if (attempt === maxAttempts) {
                return {
                    courseJson: null,
                    quizJson: null,
                    sourceText,
                    error: `Failed to generate course after ${maxAttempts} attempts: ${error.message}`,
                };
            }
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }

    // ── Stage 2: Generate Quiz JSON ──
    const questionCount = Math.max(8, Math.min(30, parseInt(data.quizQuestionCount) || 10));
    const difficulty = (['easy', 'medium', 'hard'].includes(data.quizDifficulty)
        ? data.quizDifficulty
        : 'medium') as QuizDifficulty;

    let quizJson: QuizV3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`[v3.1] Quiz generation attempt ${attempt}/${maxAttempts}`);
            const result = await generateQuizJsonV3(courseRaw!, questionCount, difficulty);
            quizJson = result.quizJson;
            break; // Success
        } catch (error: any) {
            console.error(`[v3.1] Quiz attempt ${attempt} failed:`, error.message);
            if (attempt === maxAttempts) {
                // Return course without quiz (partial success)
                return {
                    courseJson: courseJson!,
                    quizJson: null,
                    sourceText,
                    error: `Course generated successfully, but quiz generation failed: ${error.message}`,
                };
            }
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }

    console.log(`[v3.1] Pipeline complete. ${courseJson!.modules.length} modules, ${quizJson!.questions.length} questions.`);

    return {
        courseJson: courseJson!,
        quizJson: quizJson!,
        sourceText,
    };
}
