'use server';


import { z } from 'zod';
import { extractTextFromFile } from '@/lib/file-parser';
import { callVertexAI, truncateToContext } from '@/lib/ai-client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

// Token budgets — keeps us well within TPM limits
const MAX_SOURCE_TOKENS = 100000; // For full course generation (large context ok)
const MAX_ANALYSIS_TOKENS = 12500; // For quick metadata analysis (~50k chars)

// Internal types for processing
interface CourseData {
    category: string;
    title: string;
    description: string;
    duration: string;
    notesCount: string;
    objectives: string[];
    // Quiz data
    quizTitle: string;
    quizQuestionCount: string;
    quizQuestionType: string;
    quizDuration: string;
    quizPassMark: string;
    quizAttempts: string;
    quizDifficulty: string;
}

// Zod Schemas
const QuizOptionSchema = z.string();
const QuizQuestionSchema = z.object({
    question: z.string(),
    type: z.enum(['multiple_choice', 'true_false']).optional(),
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

            // Truncate to token budget for safe processing
            sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
        } catch (err: any) {
            console.error("File parsing error:", err);
            return { modules: [], quiz: [], error: `Failed to read document: ${err.message}` };
        }
    }

    const prompt = `
        You are an expert instructional designer. Create a comprehensive course outline and quiz for a Learning Management System.
        
        COURSE INFORMATION:
        Topic/Title: ${data.title}
        Category: ${data.category}
        Description: ${data.description}
        Estimated Course Duration: ${data.duration} minutes total
        Number of Modules/Sections: ${data.notesCount || '5'} modules
        
        LEARNING OBJECTIVES (users should achieve these by course end):
        ${data.objectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n        ')}
        
        SOURCE MATERIAL:
        ${sourceText ? `Use the following text as the GROUND TRUTH for the course content. 
        IMPORTANT: CITATION REQUIREMENT
        - When writing the module content, whenever you state a fact derived from the source text, append a citation marker like [1], [2], etc.
        - You MUST include a "citations" array in the JSON output.
        - Each citation object must include the "id" (number) and the "quote" (EXACT text segment from the source).
        
        SOURCE TEXT START:
        ${sourceText}
        SOURCE TEXT END` : 'No source document provided. Generate content based on general knowledge.'}
        
        QUIZ CONFIGURATION:
        Quiz Title: ${data.quizTitle}
        Number of Questions: ${data.quizQuestionCount}
        Question Type: ${data.quizQuestionType || 'Multiple Choice'}
        Estimated Quiz Duration: ${data.quizDuration} minutes
        Passing Score Target: ${data.quizPassMark} (design questions so this pass rate is achievable but meaningful)
        Difficulty Level: ${data.quizDifficulty || 'Moderate'} (Adjust question complexity accordingly)

        QUESTION TYPE INSTRUCTIONS:
        - If Question Type is "Multiple Choice": Provide 4 options for each question. Start options with capital letters.
        - If Question Type is "True / False": Provide EXACTLY 2 options: ["True", "False"].
        - If Question Type is "Mixed": Generate a mix of "Multiple Choice" and "True / False" questions. Roughly 50/50 mix.
        
        CRITICAL OUTPUT INSTRUCTIONS:
        1. Return ONLY a valid JSON object. No markdown formatting (no \`\`\`json), no introductory text.
        2. **Output MINIFIED JSON (single line)** to avoid formatting errors.
        3. **ESCAPE ALL newlines** within string values as \\n. Do not use literal control characters.
        4. Create EXACTLY ${data.notesCount || '5'} modules to match user's preference.
        5. Design quiz with EXACTLY ${data.quizQuestionCount} questions.
        6. The JSON must strictly match this schema:
        {
            "modules": [
                {
                    "title": "Module Title",
                    "content": "Detailed HTML content...",
                    "duration": "X min"
                }
            ],
            "quiz": [
                {
                    "question": "Question text",
                    "type": "multiple_choice" | "true_false",
                    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
                    "answer": 0
                }
            ],
            "citations": [
                {
                    "id": 1,
                    "quote": "Exact text...",
                    "comment": "Optional"
                }
            ]
        }
        7. Total module durations should add up to approximately ${data.duration} minutes.
        8. Ensure the quiz tests the learning objectives.
        9. DO NOT USE PLACEHOLDERS.
    `;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`AI Generation Attempt ${attempts}/${maxAttempts}`);

            const textPart = await callVertexAI(prompt);

            // Cleanup potential markdown and bad characters
            let cleanText = textPart.trim();
            if (cleanText.startsWith('```json')) {
                cleanText = cleanText.replace(/```json\n?/, '').replace(/```$/, '');
            } else if (cleanText.startsWith('```')) {
                cleanText = cleanText.replace(/```\n?/, '').replace(/```$/, '');
            }

            // Remove potential bad control characters (0x00-0x1F) except valid JSON whitespace (BS, HT, LF, FF, CR)
            // JSON valid whitespace: \b (08), \t (09), \n (0A), \f (0C), \r (0D)
            // Actually, inside strings they must be escaped. Outside, they are whitespace.
            // If the AI outputs a literal tab inside a string, it's invalid.
            // A simple approach is to use a regex to strip non-printable chars if they cause issues,
            // but strict parsing is better. The Prompt fix (MINIFIED JSON) is the primary defense.

            // Parse JSON
            let parsedData;
            try {
                parsedData = JSON.parse(cleanText);
            } catch (jsonErr) {
                console.warn("Initial JSON parse failed, attempting to repair...", jsonErr);
                // Fallback: dangerous replace of unescaped newlines?
                // Or typically, just removing newlines that break the string.
                // For now, let's rely on the prompt improvement.
                throw jsonErr;
            }

            // Validate with Zod
            const validationResult = CourseContentSchema.safeParse(parsedData);

            if (!validationResult.success) {
                console.error("Validation failed:", validationResult.error);
                throw new Error("Generated content did not match expected schema");
            }

            return {
                ...validationResult.data,
                sourceText: sourceText
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

// Schema for document analysis
const CourseMetadataSchema = z.object({
    title: z.string(),
    description: z.string(),
    objectives: z.array(z.string()).min(3),
    duration: z.string().describe("Estimated duration in minutes, e.g. '60'"),
    quizTitle: z.string().describe("A catching title for the quiz"),
});

export type AnalyzedMetadata = z.infer<typeof CourseMetadataSchema> & { error?: string };

export async function analyzeDocument(formData: FormData): Promise<AnalyzedMetadata> {
    const file = formData.get('file') as File | null;
    if (!file) return { title: '', description: '', objectives: [], duration: '', quizTitle: '', error: "No file provided" };

    try {
        console.log(`Analyzing file: ${file.name} (${file.type}, ${file.size} bytes)`); // Debug log
        const sourceText = await extractTextFromFile(file);
        console.log(`Source text length for analysis: ${sourceText.length}`); // Debug log

        if (!sourceText || sourceText.length < 50) {
            console.error(`Extraction failed: Text length is ${sourceText?.length || 0}`);
            throw new Error(`Could not extract enough text (${sourceText?.length || 0} characters) from the file to analyze. Please ensure the PDF contains selectable text, not just images. If you cannot select the text with your mouse, it is likely an image scan.`);
        }

        // Truncate for analysis speed & cost
        const truncatedText = truncateToContext(sourceText, MAX_ANALYSIS_TOKENS);

        const systemPrompt = `
            You are an expert instructional designer. Analyze the following document text and extract key course metadata.
            
            DOCUMENT TEXT START:
            ${truncatedText}
            DOCUMENT TEXT END
            `;

        const prompt = `
            ${systemPrompt}

            Output a valid JSON object with the following fields:
            - title: A professional, engaging title for a training course based on this content.
            - description: A concise (2-3 sentences) summary of what this course covers.
            - objectives: An array of 3-5 distinct learning objectives (start with action verbs).
            - duration: Estimated time in minutes to read/complete this content (just the number, e.g. "45").
            - quizTitle: A relevant title for the assessment quiz (e.g. "Knowledge Check: [Topic]").

            Return ONLY valid JSON.
        `;

        const textPart = await callVertexAI(prompt);
        let rawText = textPart;

        console.log("Raw AI Response:", rawText); // Debug log

        // Robust JSON extraction: Find the first '{' and last '}'
        const firstOpenBrace = rawText.indexOf('{');
        const lastCloseBrace = rawText.lastIndexOf('}');

        if (firstOpenBrace !== -1 && lastCloseBrace !== -1 && lastCloseBrace > firstOpenBrace) {
            rawText = rawText.substring(firstOpenBrace, lastCloseBrace + 1);
        } else {
            console.error("No JSON block found in response.");
            throw new Error("AI response did not contain valid JSON.");
        }

        const parsedData = JSON.parse(rawText);
        const result = CourseMetadataSchema.safeParse(parsedData);

        if (result.success) {
            return result.data;
        } else {
            console.error("Analysis Schema Validation Failed:", result.error);
            // Fallback with partial data if possible
            return {
                title: parsedData.title || file.name.replace(/\.[^/.]+$/, ""),
                description: parsedData.description || "Generated from uploaded document.",
                objectives: parsedData.objectives || ["Understand the document content."],
                duration: parsedData.duration || "30",
                quizTitle: parsedData.quizTitle || `Quiz: ${file.name.replace(/\.[^/.]+$/, "")}`,
            };
        }

    } catch (error: any) {
        console.error("Document Analysis Error:", error);
        return {
            title: file.name,
            description: "Failed to analyze document automatically.",
            objectives: ["Review the document content."],
            duration: "30",
            quizTitle: `Quiz: ${file.name}`,
            error: error.message
        };
    }
}

export async function analyzeStoredDocument(documentId: string): Promise<AnalyzedMetadata> {
    const session = await auth();
    if (!session?.user?.id) return { title: '', description: '', objectives: [], duration: '', quizTitle: '', error: "Unauthorized" };

    try {
        const doc = await prisma.document.findUnique({
            where: { id: documentId, userId: session.user.id },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
        });

        if (!doc) return { title: '', description: '', objectives: [], duration: '', quizTitle: '', error: "Document not found" };

        const latestVersion = doc.versions[0];
        const sourceText = latestVersion?.content || "";
        const filename = doc.filename;

        console.log(`Analyzing stored file: ${filename} (Length: ${sourceText.length})`);

        if (!sourceText || sourceText.length < 50) {
            console.error(`Extraction failed/empty: Text length is ${sourceText?.length || 0}`);
            return {
                title: filename,
                description: "Document content is empty or too short to analyze.",
                objectives: ["Review the document content manually."],
                duration: "30",
                quizTitle: `Quiz: ${filename}`,
                error: "Document content is empty or too short."
            };
        }

        // Truncate for analysis speed & cost
        const truncatedText = truncateToContext(sourceText, MAX_ANALYSIS_TOKENS);

        const systemPrompt = `
            You are an expert instructional designer. Analyze the following document text and extract key course metadata.
            
            DOCUMENT TEXT START:
            ${truncatedText}
            DOCUMENT TEXT END
            `;

        const prompt = `
            ${systemPrompt}

            Output a valid JSON object with the following fields:
            - title: A professional, engaging title for a training course based on this content.
            - description: A concise (2-3 sentences) summary of what this course covers.
            - objectives: An array of 3-5 distinct learning objectives (start with action verbs).
            - duration: Estimated time in minutes to read/complete this content (just the number, e.g. "45").
            - quizTitle: A relevant title for the assessment quiz (e.g. "Knowledge Check: [Topic]").

            Return ONLY valid JSON.
        `;

        const textPart = await callVertexAI(prompt);
        let rawText = textPart;

        console.log("Raw AI Response:", rawText);

        // Robust JSON extraction
        const firstOpenBrace = rawText.indexOf('{');
        const lastCloseBrace = rawText.lastIndexOf('}');

        if (firstOpenBrace !== -1 && lastCloseBrace !== -1 && lastCloseBrace > firstOpenBrace) {
            rawText = rawText.substring(firstOpenBrace, lastCloseBrace + 1);
        } else {
            console.error("No JSON block found in response.");
            throw new Error("AI response did not contain valid JSON.");
        }

        const parsedData = JSON.parse(rawText);
        const result = CourseMetadataSchema.safeParse(parsedData);

        if (result.success) {
            return result.data;
        } else {
            console.error("Analysis Schema Validation Failed:", result.error);
            // Fallback with partial data if possible
            return {
                title: parsedData.title || filename.replace(/\.[^/.]+$/, ""),
                description: parsedData.description || "Generated from uploaded document.",
                objectives: parsedData.objectives || ["Understand the document content."],
                duration: parsedData.duration || "30",
                quizTitle: parsedData.quizTitle || `Quiz: ${filename.replace(/\.[^/.]+$/, "")}`,
            };
        }

    } catch (error: any) {
        console.error("Stored Document Analysis Error:", error);
        return {
            title: "Course Title",
            description: "Failed to analyze document automatically.",
            objectives: ["Review the document content."],
            duration: "30",
            quizTitle: "Quiz",
            error: error.message
        };
    }
}

// --- PHI Detection ---

const PHI_PATTERNS = {
    SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    PHONE: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g,
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Basic email
    DATE: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, // MM/DD/YYYY or similar
    MRN_KEYWORD: /\b(MRN|Medical Record Number|Patient ID|Patient No)\b/i,
};

// PHI Detection Schema
const PhiDetectionSchema = z.object({
    hasPhi: z.boolean(),
    reason: z.string().optional()
});

export type PhiScanResult = z.infer<typeof PhiDetectionSchema> & { error?: string };

export async function scanDocumentForPhi(formData: FormData): Promise<PhiScanResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) return { hasPhi: false, error: "Missing API Key" };

    const file = formData.get('file') as File | null;
    if (!file) return { hasPhi: false, error: "No file provided" };

    try {
        console.log(`Scanning file for PHI: ${file.name}`);
        const sourceText = await extractTextFromFile(file);

        if (!sourceText || sourceText.length < 50) {
            console.warn("Text too short for PHI scan");
            return { hasPhi: false, reason: "Text too short to analyze" };
        }

        const truncatedText = sourceText.length > 50000 ? sourceText.substring(0, 50000) + "..." : sourceText;

        // 1. Regex Pass
        const regexMatches: string[] = [];
        if (PHI_PATTERNS.SSN.test(truncatedText)) regexMatches.push("Social Security Number pattern");
        if (PHI_PATTERNS.PHONE.test(truncatedText)) regexMatches.push("Phone Number pattern");
        if (PHI_PATTERNS.EMAIL.test(truncatedText)) regexMatches.push("Email Address pattern");
        if (PHI_PATTERNS.DATE.test(truncatedText)) regexMatches.push("Date pattern (potential DOB)");
        if (PHI_PATTERNS.MRN_KEYWORD.test(truncatedText)) regexMatches.push("Medical Record Number keyword");

        console.log("Regex Flags:", regexMatches);

        // 2. AI Verification
        let promptContext = "";
        if (regexMatches.length > 0) {
            promptContext = `
            ATTENTION: We detected specific patterns in the text: ${regexMatches.join(", ")}.
            Your job is to VERIFY if these are actual PHI or false positives (e.g., support emails, business phones, publication dates).
            `;
        } else {
            promptContext = `
            No obvious regex patterns were found, but scan specifically for unstructured PHI like "Patient: [Name]" or narrative medical history.
            `;
        }

        const prompt = `
            You are a rigorous privacy compliance officer. Analyze the following text for Protected Health Information (PHI) under HIPAA.
            
            ${promptContext}

            DEFINITIONS:
            - PHI includes: Patient Names, DOB, MRN, SSN, Patient Contact Info, Medical History tied to an individual.
            - NOT PHI: Provider names, business addresses, generic policy examples, fictional template data (e.g. "John Doe").

            INSTRUCTIONS:
            - Return JSON: { "hasPhi": boolean, "reason": "Short explanation" }.
            - If Regex flagged a phone number, check if it's a patient's number (PHI) vs a helpdesk/agency number (Safe).
            - If Regex flagged a date, check if it's a DOB/Admission Date (PHI) vs a policy effective date (Safe).
            - Be Conservative: If you are unsure if it's real patient data, err on the side of caution but try to distinguish templates.

            TEXT START:
            ${truncatedText}
            TEXT END
            
            Return ONLY valid JSON.
        `;

        const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
        const location = process.env.GOOGLE_LOCATION || 'us-central1';
        const modelId = 'gemini-2.5-flash-lite';

        const response = await fetch(
            `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.1,
                        responseMimeType: "application/json"
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Vertex AI Request Failed: ${response.status}`);
        }

        const json = await response.json();
        const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textPart) throw new Error("No content generated");

        // Clean JSON
        let cleanJson = textPart.trim();
        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.replace(/```json\n?/, '').replace(/```$/, '');
        if (cleanJson.startsWith('```')) cleanJson = cleanJson.replace(/```\n?/, '').replace(/```$/, '');

        const parsedData = JSON.parse(cleanJson);
        return {
            hasPhi: parsedData.hasPhi,
            reason: parsedData.reason
        };

    } catch (error: any) {
        console.error("PHI Scan Error:", error);
        return { hasPhi: false, error: error.message };
    }
}
