import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
    try {
        const { policyId, fileUrl, fileName, deliveryFormat = 'pages' } = await request.json();

        // Verify authentication
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error("Auth error in policy analysis:", authError);
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        console.log("Policy analysis - User authenticated:", user.id);
        console.log("Policy analysis - Looking for policy ID:", policyId);

        // Get user's organization and role for debugging
        const { data: userData, error: userError } = await supabase
            .from("users")
            .select("organization_id, role")
            .eq("id", user.id)
            .single();

        console.log("Policy analysis - User data:", userData, "Error:", userError);

        // Get policy from database
        const { data: policy, error: policyError } = await supabase
            .from("policies")
            .select("*")
            .eq("id", policyId)
            .single();

        console.log("Policy analysis - Policy lookup result:", {
            found: !!policy,
            error: policyError,
            policyOrgId: policy?.organization_id,
            userOrgId: userData?.organization_id
        });

        if (policyError || !policy) {
            console.error("Policy not found error:", policyError);
            return NextResponse.json({
                error: `Policy not found. This may be an RLS permission issue. User: ${user.id}, Policy: ${policyId}`,
                details: policyError?.message
            }, { status: 404 });
        }

        // Fetch the file content
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
            throw new Error("Failed to fetch policy file");
        }

        const fileBuffer = await fileResponse.arrayBuffer();

        // Prepare prompt
        const formatInstructions = deliveryFormat === 'slides'
            ? `
**DELIVERY FORMAT: SLIDES**
- Structure the lesson notes with clear slide breaks
- Add a horizontal rule (---) after EACH major section (after Introduction, after each Key Concept, after Procedures, etc.)
- Keep each slide focused and concise (200-400 words max per slide)
- Each slide should cover ONE main concept or topic
- Use this structure:
  # Course Title
  Brief introduction (2-3 sentences)
  ---
  ## Section 1: [Topic]
  Content for this slide
  ---
  ## Section 2: [Next Topic]
  Content for this slide
  ---
  (Continue with more slides)
`
            : `
**DELIVERY FORMAT: PAGES**
- Structure the lesson notes as continuous flowing text
- Use horizontal rules (---) sparingly, only between major topic shifts
- Content can flow naturally across sections without strict breaks
`;

        const prompt = `You are a CARF (Commission on Accreditation of Rehabilitation Facilities) compliance expert. Analyze this policy document and generate a comprehensive training course.

${formatInstructions}

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

CRITICAL: You MUST return valid JSON. Ensure all strings are properly escaped:
- Escape double quotes as \\"
- Escape backslashes as \\\\
- Escape newlines as \\n
- Do NOT include any text outside the JSON object

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

        let promptParts: any[] = [prompt];

        if (fileName.endsWith(".pdf")) {
            const fileData = Buffer.from(fileBuffer).toString("base64");
            promptParts.unshift({
                inlineData: {
                    data: fileData,
                    mimeType: "application/pdf",
                },
            });
        } else if (fileName.match(/\.docx?$/)) {
            // Extract text from DOCX
            try {
                const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
                const text = result.value;
                promptParts.unshift(text);
            } catch (e) {
                console.error("Mammoth extraction error:", e);
                throw new Error("Failed to extract text from document");
            }
        } else {
            throw new Error("Unsupported file type");
        }

        // Analyze with Gemini using JSON mode
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const result = await model.generateContent(promptParts);

        const responseText = result.response.text();

        // With JSON mode, the response should be clean JSON (no markdown wrappers)
        // But we'll still handle edge cases
        let jsonText = responseText.trim();

        // Remove markdown code blocks if present (shouldn't happen with JSON mode)
        if (jsonText.startsWith("```json")) {
            jsonText = jsonText.split("```json")[1].split("```")[0].trim();
        } else if (jsonText.startsWith("```")) {
            jsonText = jsonText.split("```")[1].split("```")[0].trim();
        }

        // Parse JSON with better error handling
        let analysisResult;
        try {
            analysisResult = JSON.parse(jsonText);
        } catch (parseError: any) {
            console.error("JSON Parse Error:", parseError.message);
            console.error("Failed JSON text (first 1000 chars):", jsonText.substring(0, 1000));

            // Log the area around the error
            const errorPos = parseInt(parseError.message.match(/\d+/)?.[0] || "0");
            if (errorPos > 0) {
                console.error("Context around error:", jsonText.substring(Math.max(0, errorPos - 200), errorPos + 200));
            }

            throw new Error(`AI generated invalid JSON. Error at position ${errorPos}: ${parseError.message}. This may indicate the PDF has complex formatting. Please try a simpler document.`);
        }

        // Create course draft
        const { data: course, error: courseError } = await supabase
            .from("courses")
            .insert({
                policy_id: policyId,
                organization_id: policy.organization_id,
                title: analysisResult.title,
                objectives: analysisResult.objectives,
                lesson_notes: analysisResult.lesson_notes,
                delivery_format: deliveryFormat,
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
