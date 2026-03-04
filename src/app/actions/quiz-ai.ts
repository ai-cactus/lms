'use server';

import { z } from 'zod';
import { callVertexAI } from '@/lib/ai-client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const SingleQuestionSchema = z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    answer: z.number().min(0).max(3),
    type: z.string().default('multiple_choice')
});

type GeneratedQuestion = z.infer<typeof SingleQuestionSchema>;

function extractJsonFromResponse(text: string): string {
    let clean = text.trim();
    const fenceMatch = clean.match(/```json\s*([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();

    const genericFenceMatch = clean.match(/```\s*([\s\S]*?)```/);
    if (genericFenceMatch) return genericFenceMatch[1].trim();

    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return clean.substring(firstBrace, lastBrace + 1);
    }

    return clean;
}

export async function generateSingleQuestion(options: { courseId?: string, context?: string }): Promise<{ success: boolean; question?: GeneratedQuestion; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Unauthorized' };
        }

        let courseContext = '';

        if (options.courseId) {
            // 1. Fetch Course Context
            const course = await prisma.course.findUnique({
                where: { id: options.courseId },
                include: {
                    lessons: {
                        orderBy: { order: 'asc' },
                        select: { title: true, content: true }
                    }
                }
            });

            if (course) {
                // Extract some context from the course to guide the AI
                // We'll limit the context so we don't blow up the token count on a single question
                courseContext = `Course Title: ${course.title}\nDescription: ${course.description || 'No description'}\n\n`;

                let lessonText = '';
                for (const lesson of course.lessons) {
                    const cleanContent = lesson.content?.replace(/<[^>]*>?/gm, ' ') || ''; // Very basic HTML strip
                    lessonText += `Module: ${lesson.title}\n${cleanContent}\n\n`;
                    if (lessonText.length > 5000) break; // Keep it bounded
                }

                courseContext += lessonText.substring(0, 8000); // hard cap
            }
        }

        if (!courseContext && options.context) {
            courseContext = options.context.substring(0, 8000);
        }

        if (!courseContext) {
            return { success: false, error: 'No course context provided' };
        }

        // 2. Build Prompt
        const prompt = `
You are an expert instructional designer and subject matter expert. 
Based on the following course content, generate a single, high-quality multiple-choice quiz question.

The question must test comprehension of the material, not just generic knowledge.

Course Context:
${courseContext}

Instructions:
1. Provide exactly 4 options.
2. Indicate the correct answer using a 0-based index (0, 1, 2, or 3).
3. Ensure the question string is clear and grammatically correct.
4. Keep the options concise.

Return ONLY a valid JSON object matching this schema:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "answer": number
}
`;

        // 3. Call AI
        const rawResponse = await callVertexAI(prompt, {
            temperature: 0.7, // Little bit of creativity for varied questions
            maxOutputTokens: 1024,
        });

        const jsonStr = extractJsonFromResponse(rawResponse);
        const parsed = JSON.parse(jsonStr);

        // 4. Validate
        const result = SingleQuestionSchema.safeParse(parsed);
        if (!result.success) {
            console.error('Quiz JSON validation failed:', result.error.format());
            return { success: false, error: 'AI generated invalid question format.' };
        }

        return { success: true, question: result.data };

    } catch (err: any) {
        console.error('generateSingleQuestion error:', err);
        return { success: false, error: err.message || 'Failed to generate question.' };
    }
}
