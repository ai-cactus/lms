"use server";

import { getGeminiModel } from "@/lib/gemini";

export async function generateQuizExplanation(
    courseTitle: string,
    questionText: string,
    correctAnswer: string,
    courseObjectives?: string[]
) {
    try {
        const model = getGeminiModel();

        const objectivesText = courseObjectives
            ? `Course Objectives: ${JSON.stringify(courseObjectives)}`
            : "";

        const prompt = `
        You are an expert tutor. Provide a concise, helpful explanation (max 2 sentences) for why the answer "${correctAnswer}" is correct for the following question.
        
        Course: ${courseTitle}
        ${objectivesText}
        
        Question: ${questionText}
        Correct Answer: ${correctAnswer}
        
        Explanation:
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return text.trim();
    } catch (error) {
        console.error("Error generating explanation:", error);
        return "Explanation currently unavailable.";
    }
}
