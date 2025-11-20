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
You are an expert instructional designer and subject matter expert.
I have processed the following documents (provided as summaries or full text below).

${metadataSection}

Your task is to create a comprehensive, professionally-formatted course based ONLY on this content.
${courseMetadata ? 'IMPORTANT: Use the provided course metadata (title, objectives, etc.) to structure your course.' : ''}

CRITICAL FORMATTING REQUIREMENTS:

1. **Structure**:
   - Course Title (H1 - use single #)${courseMetadata ? ` - USE: "${courseMetadata.title}"` : ''}
   - Brief Course Description (2-3 sentences)${courseMetadata ? ` - USE: "${courseMetadata.description}"` : ''}
   - Horizontal rule (---) after description
   - Module 1: [Title] (H2 - use ##)
   - Module 2: [Title] (H2)
   - Continue with additional modules as needed

2. **Within Each Module**:
   - Use H3 (###) for Key Concepts/Subtopics
   - Use **bold** for important terms and definitions
   - Use bullet points (-) for lists
   - Use numbered lists (1., 2., 3.) for sequential steps
   - Add horizontal rules (---) between major modules

3. **Mathematical Content**:
   - Use LaTeX for ALL mathematical expressions
   - Inline math: $x^2 + y^2 = z^2$
   - Block equations: $$\\\\lim_{x \\\\to \\\\infty} f(x) = L$$
   - ALWAYS escape backslashes in LaTeX (use \\\\ instead of \\)

4. **Code Examples** (if applicable):
   - Use fenced code blocks with language tags
   \`\`\`python
   def example():
       return "formatted code"
   \`\`\`

5. **Tables** (when comparing concepts):
   | Concept | Description | Example |
   |---------|-------------|---------|
   | Item 1  | Details     | Demo    |

6. **Spacing and Readability**:
   - Add blank lines between paragraphs
   - Add blank lines before and after headings
   - Add blank lines before and after lists
   - Add blank lines before and after code blocks
   - Use proper paragraph breaks (don't create walls of text)

7. **Content Quality**:
   - Make explanations clear and educational
   - Include practical examples where appropriate
   - Use analogies to explain complex concepts
   - Add visual structure with blockquotes for important notes:
     > **Note**: Important information here
   ${courseMetadata?.objectives ? `- Ensure the course addresses these learning objectives:\n${courseMetadata.objectives.map((obj: string, i: number) => `     ${i + 1}. ${obj}`).join('\n')}` : ''}

8. **Summary Section**:
   - End with a summary using checkmarks (✓) for key takeaways

EXAMPLE STRUCTURE:
# Course Title

Brief description of what students will learn.

---

## Module 1: Introduction

### Key Concept 1
Explanation with **bold terms** and proper spacing.

Mathematical example: $f(x) = x^2$

### Key Concept 2
More content with lists:
- Point 1
- Point 2
- Point 3

---

## Module 2: Advanced Topics

Content here...

---

## Summary

✓ Key takeaway 1
✓ Key takeaway 2

NOW CREATE THE COURSE FROM THIS CONTENT:

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
