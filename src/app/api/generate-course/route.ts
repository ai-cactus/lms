import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";
import { chunkText } from "@/lib/text-processing";
import { extractTextFromFile } from "@/lib/file-processing";

export async function POST(req: NextRequest) {
    try {
        const { files, courseMetadata } = await req.json();
        // files is an array of { name: string, content: string }
        // courseMetadata is optional: { title, description, objectives, category, difficulty, duration, complianceMapping }

        if (!files || files.length === 0) {
            return NextResponse.json({ error: "No files provided" }, { status: 400 });
        }

        const model = getGeminiModel();

        // 1. Process files (Extract text from PDF/Images/Text)
        const processedFiles = await Promise.all(files.map(async (file: any) => {
            try {
                const text = await extractTextFromFile(file);
                return `--- DOCUMENT: ${file.name} ---\n${text}\n--- END DOCUMENT ---\n`;
            } catch (e) {
                console.error(`Failed to process file ${file.name}:`, e);
                return `--- DOCUMENT: ${file.name} (FAILED TO READ) ---\n\n--- END DOCUMENT ---\n`;
            }
        }));

        let fullText = processedFiles.join("\n");

        // 2. Check if content is too large (approx 1M tokens is roughly 4M chars, but let's be safe with 500k chars)
        // The user hit 1.6M tokens, which is huge.
        // Let's set a threshold for chunking.
        const CHAR_LIMIT = 100000; // Start chunking if > 100k chars
        let contextForGeneration = fullText;

        if (fullText.length > CHAR_LIMIT) {
            console.log(`Content length ${fullText.length} exceeds limit. Initiating Map-Reduce summarization.`);

            // Chunking
            const chunks = chunkText(fullText, 50000); // 50k chars per chunk
            console.log(`Split into ${chunks.length} chunks.`);

            // Map: Summarize each chunk
            // Map: Summarize each chunk sequentially to avoid rate limits
            const summaries: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                let retries = 3;
                let success = false;

                while (retries > 0 && !success) {
                    try {
                        // Add a small delay between requests to respect rate limits (e.g., 2 seconds)
                        if (i > 0) await new Promise(resolve => setTimeout(resolve, 2000));

                        const summaryPrompt = `
                            You are an expert analyst. Summarize the following document section, capturing all key concepts, definitions, and structural elements. 
                            This summary will be used to create a course, so ensure no educational value is lost.
                            
                            Text:
                            ${chunk}
                        `;
                        const result = await model.generateContent(summaryPrompt);
                        const response = await result.response;
                        summaries.push(`--- SUMMARY PART ${i + 1} ---\n${response.text()}\n`);
                        success = true;
                    } catch (e: any) {
                        console.error(`Error summarizing chunk ${i} (Attempt ${4 - retries}):`, e.message);
                        if (e.message.includes("429") || e.status === 429) {
                            // If rate limited, wait longer (e.g., 10s) and retry
                            console.log("Rate limit hit. Waiting 10s before retry...");
                            await new Promise(resolve => setTimeout(resolve, 10000));
                            retries--;
                        } else {
                            // Non-retriable error, break
                            break;
                        }
                    }
                }

                if (!success) {
                    console.warn(`Failed to summarize chunk ${i} after retries. Skipping.`);
                }
            }

            contextForGeneration = summaries.join("\n");
            console.log("Summarization complete. Proceeding to course generation.");
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

        const prompt = `
You are an expert instructional designer and master educator with exceptional teaching skills.
I have processed the following documents (provided as summaries or full text below).

${metadataSection}

Your task is to create a DETAILED, COMPREHENSIVE, ENGAGING course based on this content.
${courseMetadata ? 'IMPORTANT: Use the provided course metadata (title, objectives, etc.) to structure your course.' : ''}

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
    } catch (error: any) {
        console.error("Error generating course:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate course" },
            { status: 500 }
        );
    }
}
