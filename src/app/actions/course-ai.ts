'use server';

import { z } from 'zod';
import { extractTextFromFile } from '@/lib/file-parser';

// Internal types for processing
interface CourseData {
    category: string;
    title: string;
    description: string;
    difficulty: string;
    duration: string;
    contentType: string;
    objectives: string[];
    // Quiz data
    quizQuestionCount: string;
    quizType: string;
}

// Zod Schemas
const QuizOptionSchema = z.string();
const QuizQuestionSchema = z.object({
    question: z.string(),
    options: z.array(z.string()).min(2),
    answer: z.number().min(0)
});

const CitationSchema = z.object({
    id: z.number(),
    quote: z.string().describe("The exact unique text quote from the source document"),
    comment: z.string().optional()
});

const ModuleSchema = z.object({
    title: z.string(),
    content: z.string(),
    duration: z.string()
});

const CourseContentSchema = z.object({
    modules: z.array(ModuleSchema).min(1),
    quiz: z.array(QuizQuestionSchema).min(1),
    citations: z.array(CitationSchema).optional()
});

// Type inference
export type GeneratedContent = z.infer<typeof CourseContentSchema> & { error?: string; sourceText?: string };

export async function generateCourseAI(formData: FormData): Promise<GeneratedContent> {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Missing Gemini API Key");
        return { modules: [], quiz: [], error: "Server configuration error: Missing API Key" };
    }

    // Extract data from FormData
    const rawData = formData.get('data');
    if (!rawData || typeof rawData !== 'string') {
        return { modules: [], quiz: [], error: "Missing course data" };
    }

    const data: CourseData = JSON.parse(rawData);
    const file = formData.get('file') as File | null;

    let sourceText = "";
    if (file) {
        try {
            console.log(`Processing file: ${file.name} (${file.type})`);
            sourceText = await extractTextFromFile(file);
            console.log(`Extracted ${sourceText.length} characters from file.`);

            // Truncate if too long (Gemini Flash Lite has 1M context window, but let's be safe with ~100k chars for now ensures speed)
            // Actually, 1M tokens is huge, we can likely pass the whole thing unless it's a book. 
            // Let's cap at 500k chars to be safe on timing.
            if (sourceText.length > 500000) {
                sourceText = sourceText.substring(0, 500000) + "...[truncated]";
            }
        } catch (err: any) {
            console.error("File parsing error:", err);
            return { modules: [], quiz: [], error: `Failed to read document: ${err.message}` };
        }
    }

    const prompt = `
        You are an expert instructional designer. Create a comprehensive course outline and quiz for a Learning Management System.
        
        INPUT DATA:
        Topic/Title: ${data.title}
        Category: ${data.category}
        Description: ${data.description}
        Target Audience Difficulty: ${data.difficulty}
        Estimated Duration: ${data.duration} minutes
        Learning Objectives: ${data.objectives.join(', ')}
        
        SOURCE MATERIAL:
        ${sourceText ? `Use the following text as the GROUND TRUTH for the course content. 
        IMPORTANT: CITATION REQUIREMENT
        - When writing the module content, whenever you state a fact derived from the source text, append a citation marker like [1], [2], etc.
        - You MUST include a "citations" array in the JSON output.
        - Each citation object must include the "id" (number) and the "quote" (EXACT text segment from the source).
        
        SOURCE TEXT START:
        ${sourceText}
        SOURCE TEXT END` : 'No source document provided. Generate content based on general knowledge.'}
        
        QUIZ REQUIREMENTS:
        Number of Questions: ${data.quizQuestionCount}
        Question Type: ${data.quizType || 'Multiple Choice'}

        CRITICAL OUTPUT INSTRUCTIONS:
        1. Return ONLY a valid JSON object. No markdown formatting (no \`\`\`json), no introductory text.
        2. The JSON must strictly match this schema:
        {
            "modules": [
                {
                    "title": "Module Title",
                    "content": "Detailed HTML content (use <h3>, <p>, <ul>, <li>). Minimum 300 words per module. Include [1] markers.",
                    "duration": "10 min"
                }
            ],
            "quiz": [
                {
                    "question": "Question text",
                    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
                    "answer": 0 // 0-based index of the correct option
                }
            ],
            "citations": [
                {
                    "id": 1,
                    "quote": "Exact text from source used for citation 1",
                    "comment": "Optional explanation"
                }
            ]
        }
        3. Create enough modules to fill the ${data.duration} minute duration.
        4. Ensure the quiz has exactly ${data.quizQuestionCount} questions.
    `;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`AI Generation Attempt ${attempts}/${maxAttempts}`);

            const response = await fetch(
                `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: "user",
                            parts: [{ text: prompt }]
                        }]
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const json = await response.json();
            const candidate = json.candidates?.[0];
            const textPart = candidate?.content?.parts?.[0]?.text;

            if (!textPart) {
                throw new Error("No content generated in response");
            }

            // Cleanup potential markdown
            let cleanText = textPart.trim();
            if (cleanText.startsWith('```json')) {
                cleanText = cleanText.replace(/```json\n?/, '').replace(/```$/, '');
            } else if (cleanText.startsWith('```')) {
                cleanText = cleanText.replace(/```\n?/, '').replace(/```$/, '');
            }

            // Parse JSON
            const parsedData = JSON.parse(cleanText);

            // Validate with Zod
            const validationResult = CourseContentSchema.safeParse(parsedData);

            if (!validationResult.success) {
                console.error("Validation failed:", validationResult.error);
                throw new Error("Generated content did not match expected schema");
            }

            return {
                ...validationResult.data,
                sourceText: sourceText // Return raw text so client can display it for highlighting
            };

        } catch (error: any) {
            console.error(`Attempt ${attempts} failed:`, error.message);

            if (attempts === maxAttempts) {
                return {
                    modules: [],
                    quiz: [],
                    error: `Failed to generate valid course content after ${maxAttempts} attempts. Error: ${error.message}`
                };
            }

            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return { modules: [], quiz: [], error: "Unknown error" };
}
