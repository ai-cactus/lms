import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";
import { extractTextFromFile } from "@/lib/file-processing";

export async function POST(req: NextRequest) {
    try {
        const { files } = await req.json();

        if (!files || files.length === 0) {
            return NextResponse.json({ error: "No files provided" }, { status: 400 });
        }

        const model = getGeminiModel();

        // 1. Process files (Extract text)
        const processedFiles = await Promise.all(files.map(async (file: any) => {
            try {
                const text = await extractTextFromFile(file);
                return `--- DOCUMENT: ${file.name} ---\n${text}\n--- END DOCUMENT ---\n`;
            } catch (e) {
                console.error(`Failed to process file ${file.name}:`, e);
                return null;
            }
        }));

        const validDocs = processedFiles.filter(doc => doc !== null) as string[];

        if (validDocs.length === 0) {
            // Collect specific errors if available
            const errorMessages = processedFiles
                .filter(doc => doc === null)
                .map((_, idx) => `File ${files[idx].name} failed to process`)
                .join("; ");

            return NextResponse.json({
                error: `No valid text could be extracted. ${errorMessages || "Please upload .docx, .pdf or text files."}`
            }, { status: 400 });
        }

        const fullText = validDocs.join("\n");

        // Truncate text to avoid hitting token limits (approx 50k chars is ~12k tokens, usually sufficient for metadata)
        const MAX_CHARS = 50000;
        const truncatedText = fullText.length > MAX_CHARS
            ? fullText.substring(0, MAX_CHARS) + "\n...[Text truncated for analysis]..."
            : fullText;

        // 2. Analyze and extract metadata
        const prompt = `
You are an expert instructional designer. Analyze the following documents and extract structured metadata for creating a training course.

DOCUMENTS:
${truncatedText}

Please provide a JSON response with the following structure:
{
  "title": "Suggested course title",
  "description": "2-3 sentence description of what learners will gain",
  "category": "One of: Healthcare Compliance, Cybersecurity and Technology, HR & Ethics, Medical Equipment, or Other",
  "difficulty": "One of: Beginner, Moderate, Advanced",
  "duration": "One of: < 30 mins, < 45 mins, < 1 hour, 1-2 hours, 2+ hours",
  "objectives": [
    "Learning objective 1",
    "Learning objective 2",
    "Learning objective 3"
  ],
  "complianceMapping": "Relevant compliance standard if applicable, or empty string"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting or code blocks.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();

        // Clean up markdown code blocks if present
        if (text.startsWith("```json")) {
            text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
        } else if (text.startsWith("```")) {
            text = text.replace(/```\n?/g, "");
        }

        const metadata = JSON.parse(text);

        return NextResponse.json({ metadata });
    } catch (error: any) {
        console.error("Error analyzing documents:", error);

        // Handle 429 specifically
        if (error.message?.includes("429") || error.status === 429) {
            return NextResponse.json(
                { error: "AI Service is busy. Please try again in a minute." },
                { status: 429 }
            );
        }

        return NextResponse.json(
            { error: error.message || "Failed to analyze documents" },
            { status: 500 }
        );
    }
}
