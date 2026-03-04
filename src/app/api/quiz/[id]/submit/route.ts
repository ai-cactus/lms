import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';

// Generate AI explanations for quiz answers using Gemini
// v3.1 courses have embedded explanations; this is the legacy fallback
async function generateExplanations(questions: any[]): Promise<Record<string, string>> {
    // Check if v3.1 embedded explanations are available
    const hasEmbedded = questions.every(q => q.explanation && q.explanation.length > 0);
    if (hasEmbedded) {
        const map: Record<string, string> = {};
        questions.forEach(q => {
            map[q.id] = q.explanation || '';
        });
        return map;
    }

    // Legacy fallback: generate explanations via AI
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) return {};

    try {
        const questionsForAI = questions.map((q, i) => ({
            num: i + 1,
            question: q.text,
            correctAnswer: q.correctAnswer,
            options: Array.isArray(q.options) ? q.options : []
        }));

        const prompt = `For each quiz question below, provide a concise 1-2 sentence explanation of WHY the correct answer is correct. Be educational and clear.

Questions:
${questionsForAI.map(q => `${q.num}. "${q.question}" — Correct answer: "${q.correctAnswer}" (Options: ${q.options.join(', ')})`).join('\n')}

Return ONLY a JSON object mapping question numbers to explanations, like:
{"1": "Explanation for Q1...", "2": "Explanation for Q2...", ...}
No markdown, no extra text.`;

        const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
        const location = process.env.GOOGLE_LOCATION || 'us-central1';
        const modelId = 'gemini-2.5-flash-lite';

        const response = await fetch(
            `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
                })
            }
        );

        if (!response.ok) return {};

        const json = await response.json();
        const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textPart) return {};

        let cleanText = textPart.trim();
        if (cleanText.startsWith('```json')) cleanText = cleanText.replace(/```json\n?/, '').replace(/```$/, '');
        if (cleanText.startsWith('```')) cleanText = cleanText.replace(/```\n?/, '').replace(/```$/, '');

        const parsed = JSON.parse(cleanText.trim());

        // Map back to question IDs
        const explanationMap: Record<string, string> = {};
        questions.forEach((q, i) => {
            explanationMap[q.id] = parsed[String(i + 1)] || '';
        });
        return explanationMap;
    } catch (err) {
        console.error('AI explanation generation failed:', err);
        return {};
    }
}

export async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const workerSession = await workerAuth();
        const adminSession = await adminAuth();

        const quizId = params.id;
        const body = await request.json();
        const { enrollmentId, answers, timeTaken } = body;

        // Verify enrollment belongs to user
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId }
        });

        if (!enrollment) {
            return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
        }

        if (enrollment.userId !== workerSession?.user?.id && enrollment.userId !== adminSession?.user?.id) {
            return NextResponse.json({ error: 'Enrollment does not belong to active sessions' }, { status: 403 });
        }

        // Get quiz with questions
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            include: { questions: true }
        });

        if (!quiz) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
        }

        // Calculate score
        let correctCount = 0;
        for (const answer of answers) {
            const question = quiz.questions.find(q => q.id === answer.questionId);
            if (question && question.correctAnswer === answer.selectedAnswer) {
                correctCount++;
            }
        }

        const totalQuestions = quiz.questions.length;
        const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
        const passed = score >= quiz.passingScore;

        // Generate AI explanations first
        const explanations = await generateExplanations(quiz.questions).catch(() => ({} as Record<string, string>));

        // Enrich answers with explanations for DB storage
        const enrichedAnswers = answers.map((a: any) => ({
            ...a,
            explanation: explanations[a.questionId] || ''
        }));

        // Check if attempt already exists
        const existingAttempt = await prisma.quizAttempt.findUnique({
            where: {
                enrollmentId_quizId: { enrollmentId, quizId }
            }
        });

        let currentAttemptCount = 1;

        if (existingAttempt) {
            // Check allowed attempts
            if (quiz.allowedAttempts && existingAttempt.attemptCount > quiz.allowedAttempts) {
                // Should not happen unless UI fails to block it. 
                // We'll process it but the attempt count is already recorded correctly in DB.
            }

            // The start route already increments the attemptCount when the attempt begins.
            // So existingAttempt.attemptCount is the correct current attempt number.
            currentAttemptCount = existingAttempt.attemptCount;

            await prisma.quizAttempt.update({
                where: { id: existingAttempt.id },
                data: {
                    answers: enrichedAnswers,
                    score,
                    timeTaken,
                    completedAt: new Date()
                }
            });
        } else {
            await prisma.quizAttempt.create({
                data: { enrollmentId, quizId, answers: enrichedAnswers, score, timeTaken, attemptCount: 1 }
            });
        }

        // Update enrollment status and score
        // CORE LOGIC: Passing the quiz does NOT complete the course. 
        // Attestation is required for completion.
        await prisma.enrollment.update({
            where: { id: enrollmentId },
            data: {
                status: 'in_progress', // Remains in_progress until attestation
                score,
                progress: 100,
                // completedAt is NOT set here anymore
            }
        });

        revalidatePath('/worker');
        revalidatePath('/dashboard/worker');

        return NextResponse.json({
            score,
            passed,
            correctCount,
            totalQuestions,
            attemptsUsed: currentAttemptCount,
            allowedAttempts: quiz.allowedAttempts,
            courseName: '',
            answered: answers.length,
            correct: correctCount,
            wrong: answers.length - correctCount,
            time: timeTaken || 0,
            questions: quiz.questions.map(q => {
                const userAnswer = answers.find((a: any) => a.questionId === q.id);
                const optionsArray = Array.isArray(q.options) ? (q.options as any[]) : [];
                const optionTexts = optionsArray.map((opt: any) => typeof opt === 'string' ? opt : opt.text || opt);

                const selectedText = userAnswer?.selectedAnswer || '';
                const selectedIdx = optionTexts.findIndex((t: string) => t === selectedText);
                const selectedLetter = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

                const correctText = q.correctAnswer || '';
                const correctIdx = optionTexts.findIndex((t: string) => t === correctText);
                const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

                return {
                    id: q.id,
                    text: q.text,
                    options: optionsArray.map((opt: any, idx: number) => ({
                        id: String.fromCharCode(65 + idx),
                        text: typeof opt === 'string' ? opt : opt.text || opt
                    })),
                    selectedAnswer: selectedLetter,
                    correctAnswer: correctLetter,
                    explanation: explanations[q.id] || ''
                };
            })
        });

    } catch (error) {
        console.error('Error submitting quiz:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
