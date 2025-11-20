import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
    try {
        const { policyId, fileUrl, fileName } = await request.json();

        // Verify authentication
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get policy from database
        const { data: policy, error: policyError } = await supabase
            .from("policies")
            .select("*")
            .eq("id", policyId)
            .single();

        if (policyError || !policy) {
            return NextResponse.json({ error: "Policy not found" }, { status: 404 });
        }

        // Fetch the file content
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
            throw new Error("Failed to fetch policy file");
        }

        const fileBuffer = await fileResponse.arrayBuffer();
        const fileData = Buffer.from(fileBuffer).toString("base64");

        // Determine MIME type
        const mimeType = fileName.endsWith(".pdf")
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        // Analyze with Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `You are a CARF (Commission on Accreditation of Rehabilitation Facilities) compliance expert. Analyze this policy document and generate a comprehensive training course.

Extract and provide:

1. **Course Title**: A clear, concise title for the training course
2. **Learning Objectives**: 3-5 specific, measurable learning objectives
3. **CARF Standards**: Map each objective to relevant CARF standards (if applicable). Use format "Standard X.X.X - Description"
4. **Lesson Notes**: Comprehensive training content that covers the policy in an easy-to-understand format. Include:
   - Introduction
   - Key concepts
   - Procedures and requirements
   - Examples and scenarios
   - Summary
5. **Quiz Questions**: Generate 10 multiple-choice questions to assess understanding. For each question provide:
   - Question text
   - 4 answer options
   - Correct answer (index 0-3)
   - Explanation

Format your response as JSON with this structure:
{
  "title": "Course Title",
  "objectives": [
    {
      "text": "Objective text",
      "carf_standard": "Standard 1.H.12.b - Description" or null,
      "carf_matched": true or false
    }
  ],
  "carf_standards": [
    {
      "code": "1.H.12.b",
      "description": "Standard description",
      "matched": true
    }
  ],
  "lesson_notes": "Full lesson content in markdown format",
  "quiz_questions": [
    {
      "question_text": "Question?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": 0,
      "explanation": "Why this is correct"
    }
  ],
  "gaps": ["Any missing or unclear CARF requirements"]
}`;

        const result = await model.generateContent([
            {
                inlineData: {
                    data: fileData,
                    mimeType: mimeType,
                },
            },
            prompt,
        ]);

        const responseText = result.response.text();

        // Extract JSON from response (handle markdown code blocks)
        let jsonText = responseText;
        if (responseText.includes("```json")) {
            jsonText = responseText.split("```json")[1].split("```")[0].trim();
        } else if (responseText.includes("```")) {
            jsonText = responseText.split("```")[1].split("```")[0].trim();
        }

        const analysisResult = JSON.parse(jsonText);

        // Create course draft
        const { data: course, error: courseError } = await supabase
            .from("courses")
            .insert({
                policy_id: policyId,
                organization_id: policy.organization_id,
                title: analysisResult.title,
                objectives: analysisResult.objectives,
                lesson_notes: analysisResult.lesson_notes,
                carf_standards: analysisResult.carf_standards || [],
                pass_mark: 80,
                attempts_allowed: 2,
            })
            .select()
            .single();

        if (courseError) {
            throw courseError;
        }

        // Create quiz questions
        const quizQuestions = analysisResult.quiz_questions.map((q: any) => ({
            course_id: course.id,
            question_text: q.question_text,
            question_type: "multiple_choice",
            options: q.options.map((text: string, index: number) => ({
                id: `opt-${index}`,
                text,
            })),
            correct_answer: q.options[q.correct_answer],
        }));

        const { error: questionsError } = await supabase
            .from("quiz_questions")
            .insert(quizQuestions);

        if (questionsError) {
            throw questionsError;
        }

        // Update policy status
        await supabase
            .from("policies")
            .update({ status: "published" })
            .eq("id", policyId);

        return NextResponse.json({
            courseId: course.id,
            gaps: analysisResult.gaps || [],
        });
    } catch (error: any) {
        console.error("Policy analysis error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to analyze policy" },
            { status: 500 }
        );
    }
}
