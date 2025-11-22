import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        const { role, programType, category } = await req.json();

        if (!role || !programType) {
            return NextResponse.json({ error: "Role and Program Type are required" }, { status: 400 });
        }

        const model = getGeminiModel();

        const prompt = `
            You are an expert in CARF accreditation standards for behavioral health and human services.
            
            Based on the following worker profile, suggest 3-5 specific training courses that would be relevant or required for CARF compliance, beyond standard mandatory training (like HIPAA or Rights).
            
            Worker Profile:
            - Role: ${role}
            - Program Type: ${programType}
            - Category: ${category || "General Staff"}
            
            Output strictly as a JSON array of objects with this structure:
            [
                {
                    "title": "Course Title",
                    "description": "Brief description of why this is relevant (1 sentence)",
                    "carfStandard": "Relevant CARF Standard (e.g., 2.A.3) or 'Best Practice'"
                }
            ]
            
            Do not include any markdown formatting or explanation, just the JSON array.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean up markdown code blocks if present
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();

        let suggestions = [];
        try {
            suggestions = JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse AI suggestions:", text);
            // Fallback or empty array
        }

        return NextResponse.json({ suggestions });

    } catch (error: any) {
        console.error("Error generating suggestions:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate suggestions" },
            { status: 500 }
        );
    }
}
