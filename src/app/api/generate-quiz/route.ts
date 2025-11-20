import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        const { courseContent } = await req.json();

        if (!courseContent) {
            return NextResponse.json({ error: "No course content provided" }, { status: 400 });
        }

        const model = getGeminiModel();

        const prompt = `
      Based on the following course content, generate a quiz with exactly 20 questions.
      
      The output must be a valid JSON array of objects.
      Each object must have the following structure:
      {
        "id": "string (unique)",
        "text": "Question text",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": number (0-3 index of the correct option)
      }
      
      Do not include any markdown formatting (like \`\`\`json) in the response, just the raw JSON array.
      
      Course Content:
      ${courseContent}
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean up markdown code blocks if present
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();

        const questions = JSON.parse(text);

        return NextResponse.json({ questions });
    } catch (error: any) {
        console.error("Error generating quiz:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate quiz" },
            { status: 500 }
        );
    }
}
