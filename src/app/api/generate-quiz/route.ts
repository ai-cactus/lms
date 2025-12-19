import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        const { courseContent, numQuestions = 15, difficulty = 'Moderate' } = await req.json();

        if (!courseContent) {
            return NextResponse.json({ error: "No course content provided" }, { status: 400 });
        }

        const model = getGeminiModel();

        const prompt = `
Based on the following course content, generate a quiz with exactly ${numQuestions} multiple-choice questions.
Difficulty level: ${difficulty}

CRITICAL REQUIREMENTS:
- ALL questions must be multiple-choice format ONLY
- Each question must have exactly 4 answer options
- Each question must have exactly 1 correct answer
- Questions should test understanding of key concepts from the course
- Make questions clear and unambiguous

The output must be a valid JSON array of objects.
Each object must have the following structure:
{
  "id": "q1" (unique id: q1, q2, q3, etc.),
  "text": "Clear question text here?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 0 (index 0-3 of the correct option),
  "explanation": "A concise explanation of why the correct answer is right and others are wrong."
}

IMPORTANT: Return ONLY the JSON array. Do not include any markdown formatting or code blocks.

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
    } catch (error) {
        console.error("Error generating quiz:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate quiz" },
            { status: 500 }
        );
    }
}
