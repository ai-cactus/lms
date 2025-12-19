import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";
import { chunkText } from "@/lib/text-processing";
import { extractTextFromFile } from "@/lib/file-processing";
import { validateDocumentForProcessing } from "@/lib/document-validation";

interface UploadedFile {
    name: string;
    type?: string;
    data?: string;
}

export async function POST(req: NextRequest) {
    try {
        const { files, courseMetadata } = await req.json();
        // files is an array of { name: string, content: string }
        // courseMetadata is optional: { title, description, objectives, category, difficulty, duration, complianceMapping }

        if (!files || files.length === 0) {
            return NextResponse.json({ error: "No files provided" }, { status: 400 });
        }

        // Pre-validate files for processing suitability
        const validationErrors: string[] = [];
        let totalEstimatedChars = 0;

        files.forEach((file: UploadedFile, index: number) => {
            // Create a mock File object for validation
            const mockFile = {
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.data ? Buffer.from(file.data.split(',')[1] || '', 'base64').length : 0
            } as File;

            const validation = validateDocumentForProcessing(mockFile);
            if (!validation.isValid) {
                validationErrors.push(`File ${index + 1} (${file.name}): ${validation.error}`);
            } else if (validation.limits) {
                // Estimate content size
                const estimatedChars = Math.floor(mockFile.size * 0.15); // Conservative estimate
                totalEstimatedChars += estimatedChars;
            }
        });

        if (validationErrors.length > 0) {
            return NextResponse.json({ 
                error: `File validation failed:\n${validationErrors.join('\n')}` 
            }, { status: 400 });
        }

        // Check if total estimated content is too large for processing
        const MAX_TOTAL_CHARS = 800000; // 800k characters total limit
        if (totalEstimatedChars > MAX_TOTAL_CHARS) {
            return NextResponse.json({ 
                error: `Combined document size too large for processing. Estimated ${Math.round(totalEstimatedChars/1000)}k characters, maximum ${Math.round(MAX_TOTAL_CHARS/1000)}k allowed. Please split into smaller documents or reduce file sizes.` 
            }, { status: 400 });
        }

        const model = getGeminiModel();

        // 1. Process files (Extract text from PDF/Images/Text) with better error handling
        const processedFiles: string[] = [];
        const processingErrors: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                console.log(`Processing file ${i + 1}/${files.length}: ${file.name}`);
                const text = await extractTextFromFile(file);
                
                if (!text || text.trim().length < 50) {
                    processingErrors.push(`${file.name}: Document appears to be empty or unreadable`);
                    continue;
                }
                
                processedFiles.push(`--- DOCUMENT: ${file.name} ---\n${text}\n--- END DOCUMENT ---\n`);
                console.log(`Successfully processed ${file.name}: ${text.length} characters`);
            } catch (e) {
                console.error(`Failed to process file ${file.name}:`, e);
                processingErrors.push(`${file.name}: ${e.message || 'Failed to extract text'}`);
            }
        }

        if (processedFiles.length === 0) {
            const errorMsg = processingErrors.length > 0 
                ? `All files failed to process:\n${processingErrors.join('\n')}`
                : 'No readable content found in uploaded files';
            return NextResponse.json({ error: errorMsg }, { status: 400 });
        }

        if (processingErrors.length > 0) {
            console.warn('Some files failed to process:', processingErrors);
        }

        const fullText = processedFiles.join("\n");

        // 2. Check if content is too large and implement smart chunking
        // Gemini 2.5 Flash has ~1M token limit (~4M chars), but we use conservative limits
        const CHAR_LIMIT = 150000; // Start chunking if > 150k chars (more generous than before)
        const actualCharCount = fullText.length;
        
        console.log(`Total extracted content: ${actualCharCount} characters`);
        
        if (actualCharCount < 100) {
            return NextResponse.json({ 
                error: 'Extracted content is too short to generate a meaningful course. Please ensure your documents contain substantial text content.' 
            }, { status: 400 });
        }
        let contextForGeneration = fullText;

        if (fullText.length > CHAR_LIMIT) {
            console.log(`Content length ${fullText.length} exceeds limit. Initiating intelligent chunking and summarization.`);

            // Use smaller chunks for better quality
            const chunks = chunkText(fullText, 40000); // 40k chars per chunk for better processing
            console.log(`Split into ${chunks.length} chunks for processing.`);

            if (chunks.length > 20) {
                return NextResponse.json({ 
                    error: `Document is too complex for processing (${chunks.length} chunks). Please split into smaller documents or reduce content size.` 
                }, { status: 400 });
            }

            // Map: Summarize each chunk with improved error handling
            const summaries: string[] = [];
            let failedChunks = 0;
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                let retries = 3;
                let success = false;

                while (retries > 0 && !success) {
                    try {
                        // Progressive delay to handle rate limits
                        const delay = Math.min(2000 + (i * 500), 5000);
                        if (i > 0) await new Promise(resolve => setTimeout(resolve, delay));

                        const summaryPrompt = `
                            You are an expert instructional designer. Summarize this document section while preserving all educational content, key concepts, procedures, and important details. 
                            Focus on maintaining the instructional value - this summary will be used to create training materials.
                            
                            IMPORTANT: Preserve specific procedures, compliance requirements, definitions, and any step-by-step instructions.
                            
                            Document Section:
                            ${chunk}
                        `;
                        
                        const result = await model.generateContent(summaryPrompt);
                        const response = await result.response;
                        const summaryText = response.text();
                        
                        if (summaryText && summaryText.length > 50) {
                            summaries.push(`--- SUMMARY PART ${i + 1} ---\n${summaryText}\n`);
                            success = true;
                            console.log(`Successfully summarized chunk ${i + 1}/${chunks.length}`);
                        } else {
                            throw new Error('Empty or invalid summary generated');
                        }
                    } catch (e) {
                        console.error(`Error summarizing chunk ${i + 1} (Attempt ${4 - retries}):`, e.message);
                        if (e.message.includes("429") || e.status === 429) {
                            const waitTime = 15000 + (retries * 5000); // Increasing wait time
                            console.log(`Rate limit hit. Waiting ${waitTime/1000}s before retry...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            retries--;
                        } else if (e.message.includes("quota") || e.message.includes("limit")) {
                            return NextResponse.json({ 
                                error: 'AI service quota exceeded. Please try again later or reduce document size.' 
                            }, { status: 429 });
                        } else {
                            retries--;
                            if (retries > 0) {
                                await new Promise(resolve => setTimeout(resolve, 3000));
                            }
                        }
                    }
                }

                if (!success) {
                    console.warn(`Failed to summarize chunk ${i + 1} after all retries.`);
                    failedChunks++;
                }
            }

            if (summaries.length === 0) {
                return NextResponse.json({ 
                    error: 'Failed to process document content. The document may be too complex or the AI service is temporarily unavailable.' 
                }, { status: 500 });
            }

            if (failedChunks > 0) {
                console.warn(`${failedChunks} chunks failed to process, continuing with ${summaries.length} successful summaries.`);
            }

            contextForGeneration = summaries.join("\n");
            console.log(`Summarization complete. Generated ${summaries.length} summaries from ${chunks.length} chunks.`);
        }

        // 3. Generate Course (Reduce)
        let metadataSection = "";
        if (courseMetadata) {
            metadataSection = `
COURSE METADATA (Use this information to guide the course creation):
- Title: ${courseMetadata.title}
- Description: ${courseMetadata.description}
- Category: ${courseMetadata.category}
- Difficulty Level: ${courseMetadata.difficulty}
- Estimated Duration: ${courseMetadata.duration}
- Learning Objectives:
${courseMetadata.objectives?.map((obj: string, i: number) => `  ${i + 1}. ${obj}`).join('\n') || ''}
${courseMetadata.complianceMapping ? `- Compliance Mapping: ${courseMetadata.complianceMapping}` : ''}
`;
        }

        // Difficulty-specific instructions
        let difficultyInstructions = "";
        if (courseMetadata?.difficulty) {
            switch (courseMetadata.difficulty) {
                case "Beginner":
                    difficultyInstructions = `
**DIFFICULTY LEVEL: BEGINNER - Keep it Simple and Accessible**
- Use plain, everyday language that anyone can understand
- Avoid jargon and technical terms; when you must use them, explain them immediately
- Use simple analogies from daily life (e.g., "like checking your email" or "similar to a recipe")
- Break concepts into small, digestible pieces
- Provide step-by-step instructions with clear examples
- Focus on practical "how-to" rather than theoretical depth
- Use encouraging, supportive tone
- Example: Instead of "implement authentication protocols", say "set up the login process"
`;
                    break;
                case "Moderate":
                    difficultyInstructions = `
**DIFFICULTY LEVEL: MODERATE - Strike a Balance Between Accessible and Technical**
- Use professional terminology but explain technical terms when first introduced
- Provide both conceptual understanding AND practical application
- Include some industry-standard terminology with context
- Use analogies that relate to professional scenarios
- Explain the "why" behind processes and decisions
- Assume basic familiarity with the field but don't assume expertise
- Balance simplicity with accuracy
- Example: "Authentication protocols verify user identity through credential validation"
`;
                    break;
                case "Advanced":
                    difficultyInstructions = `
**DIFFICULTY LEVEL: ADVANCED - Detailed, Technical, and Research-Level**
- Use precise technical terminology without oversimplification
- Provide in-depth theoretical foundations and underlying principles
- Include technical specifications, standards, and best practices
- Reference industry frameworks, compliance requirements, and research findings
- Explain complex mechanisms, edge cases, and implementation details
- Assume professional expertise; dive into nuanced topics
- Use technical analogies that demonstrate deep understanding
- Include "why it matters" from compliance, security, and operational perspectives
- Provide detailed examples with multiple scenarios and considerations
- Example: "Implement OAuth 2.0 authorization flows with PKCE extensions for enhanced security in mobile applications, considering token lifecycle management and refresh strategies"
`;
                    break;
            }
        }

        const prompt = `
You are an expert instructional designer and master educator with exceptional teaching skills.
I have processed the following documents (provided as summaries or full text below).

${metadataSection}

${difficultyInstructions}

Your task is to create a DETAILED, COMPREHENSIVE, ENGAGING course based on this content.
${courseMetadata ? 'IMPORTANT: Use the provided course metadata (title, objectives, etc.) to structure your course. CRITICAL: Adjust the complexity and depth based on the difficulty level specified above.' : ''}

CRITICAL REQUIREMENTS:

1. **CHARACTER LIMIT PER MODULE**: 
   - MAXIMUM 1000 characters per module (excluding the H2 heading itself)
   - Count every character in the module content
   - If a concept needs more space, create multiple parts:
     * ## Module 5: Advanced Concepts - Part 1
     * ## Module 5: Advanced Concepts - Part 2
     * etc.

2. **CONTENT QUALITY - DETAILED & COMPREHENSIVE**:
   - Provide RICH, DETAILED explanations - DO NOT over-summarize
   - Use analogies to make concepts relatable and memorable
   - Include real-world examples for every major concept
   - Explain the "why" behind concepts, not just the "what"
   - Teach thoroughly - imagine you're explaining to someone new to the topic
   - NO lazy bullet-point summaries without context

3. **TEACHING APPROACH**:
   - Write like an expert instructor giving a lecture
   - Use relatable analogies: "Think of it like..." or "It's similar to..."
   - Provide concrete examples: "For instance..." or "Consider this scenario..."
   - Explain implications: "This matters because..." or "The impact is..."
   - Make connections to prior knowledge when relevant
   - Engage the learner with clear, conversational explanations

4. **STRUCTURE**:
   - Course Title (H1 - use single #)${courseMetadata ? ` - USE: "${courseMetadata.title}"` : ''}
   - Brief Course Description (2-3 sentences)${courseMetadata ? ` - USE: "${courseMetadata.description}"` : ''}
   - Horizontal rule (---) after description
   - Module 1: [Title] (H2 - use ##)
   - Add horizontal rule (---) after EVERY module
   - Module 2: [Title] (H2)
   - Continue with as many modules as needed
   - Split long concepts into Part 1, Part 2, etc.

5. **WITHIN EACH MODULE** (remember: max 1000 chars):
   - Start with a clear introduction to the concept
   - Use **bold** for key terms when first introduced
   - Use bullet points for lists, but include context/explanation
   - Use numbered lists for sequential steps with explanations
   - Use paragraphs for rich explanations (3-5 sentences each)
   - Include specific examples in italics when helpful
   - End with why it matters or how it applies

6. **MATHEMATICAL CONTENT** (if applicable):
   - Use LaTeX for mathematical expressions
   - Inline math: $x^2 + y^2 = z^2$
   - Block equations: $$\\\\lim_{x \\\\to \\\\infty} f(x) = L$$
   - ALWAYS escape backslashes (use \\\\ instead of \\)
   - Explain equations in plain language

7. **FORMATTING FOR READABILITY**:
   - Blank lines between paragraphs
   - Blank lines before and after headings
   - Blank lines before and after lists
   - Use > **Note**: for important callouts
   - Horizontal rule (---) after every module
   ${courseMetadata?.objectives ? `- Address these learning objectives:\n${courseMetadata.objectives.map((obj: string, i: number) => `     ${i + 1}. ${obj}`).join('\n')}` : ''}

8. **PACING & SPLITTING CONTENT**:
   - If explaining a complex topic, don't cram it into one module
   - Create "Part 1, Part 2, Part 3" modules to cover it thoroughly
   - Each part should be under 1000 characters but rich with detail
   - Better to have 30 detailed modules than 10 rushed ones

EXAMPLE STRUCTURE (notice detailed explanations within character limit):

# Introduction to Behavioral Health Compliance

This course provides comprehensive training on behavioral health policies and procedures. You'll learn critical compliance requirements, documentation standards, and best practices for delivering quality care.

---

## Module 1: Understanding Policy Frameworks

A **policy framework** is the foundation that guides all organizational decisions and actions. Think of it like a building's blueprint – it provides the structure and guidelines for everything built upon it. In behavioral health, this framework ensures consistent, ethical, and compliant care delivery.

Independent Health's policy framework serves three key purposes: establishing standards, protecting patients, and ensuring regulatory compliance. When providers understand this framework, they can make informed decisions that align with organizational values and legal requirements.

---

## Module 2: The Role of Documentation - Part 1

Documentation is the backbone of quality healthcare delivery. It serves as both a communication tool and a legal record. Imagine documentation as a detailed map of a patient's journey through treatment – without it, continuity of care becomes impossible.

Every session note, assessment, and treatment plan contributes to this comprehensive record. These documents communicate your clinical reasoning to other providers, justify medical necessity to payers, and demonstrate compliance with regulations.

---

## Module 2: The Role of Documentation - Part 2  

Beyond communication, documentation protects both patients and providers. It creates an audit trail for quality assurance and legal defense. When done correctly, your documentation tells the story of why specific interventions were chosen and how the patient responded.

Key elements include: date and time, presenting problems, interventions used, patient response, and next steps. Each element serves a specific purpose in creating a complete clinical picture.

---

## Summary

✓ You can identify the purpose and structure of policy frameworks
✓ You understand comprehensive documentation requirements and their importance  
✓ You can explain why detailed record-keeping protects patients and providers

NOW CREATE THE COURSE FROM THIS CONTENT:
- Use MAXIMUM 1000 characters per module (excluding heading)
- Provide DETAILED, RICH explanations with analogies
- Split complex topics into Part 1, Part 2, etc. as needed
- NO over-summarization - teach thoroughly

${contextForGeneration}
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return NextResponse.json({ content: text });
    } catch (error) {
        console.error("Error generating course:", error);
        
        // Provide more specific error messages
        if (error.message?.includes("429") || error.status === 429) {
            return NextResponse.json(
                { error: "AI service is busy. Please try again in a few minutes." },
                { status: 429 }
            );
        }
        
        if (error.message?.includes("quota") || error.message?.includes("limit")) {
            return NextResponse.json(
                { error: "AI service quota exceeded. Please try again later or reduce document size." },
                { status: 429 }
            );
        }
        
        if (error.message?.includes("timeout")) {
            return NextResponse.json(
                { error: "Document processing timed out. Please try with a smaller document." },
                { status: 408 }
            );
        }
        
        return NextResponse.json(
            { error: "Failed to generate course content. Please try again or contact support if the problem persists." },
            { status: 500 }
        );
    }
}
