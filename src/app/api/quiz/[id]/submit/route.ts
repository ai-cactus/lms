import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const submitQuizSchema = z.object({
  enrollmentId: z.string().min(1, 'Enrollment ID is required'),
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedAnswer: z.string(),
    })
  ),
  timeTaken: z.number().nullable().optional(),
});

interface QuizQuestionWithExplanation {
  id: string;
  text: string;
  correctAnswer: string;
  options: unknown;
  explanation?: string | null;
}

// Generate AI explanations for quiz answers using Gemini
// v3.1 courses have embedded explanations; this is the legacy fallback
async function generateExplanations(
  questions: QuizQuestionWithExplanation[],
): Promise<Record<string, string>> {
  // Check if v3.1 embedded explanations are available
  const hasEmbedded = questions.every((q) => q.explanation && q.explanation.length > 0);
  if (hasEmbedded) {
    const map: Record<string, string> = {};
    questions.forEach((q) => {
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
      options: Array.isArray(q.options) ? q.options : [],
    }));

    const prompt = `For each quiz question below, provide a concise 1-2 sentence explanation of WHY the correct answer is correct. Be educational and clear.

Questions:
${questionsForAI.map((q) => `${q.num}. "${q.question}" — Correct answer: "${q.correctAnswer}" (Options: ${q.options.join(', ')})`).join('\n')}

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
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
      },
    );

    if (!response.ok) return {};

    const json = await response.json();
    const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPart) return {};

    let cleanText = textPart.trim();
    if (cleanText.startsWith('```json'))
      cleanText = cleanText.replace(/```json\n?/, '').replace(/```$/, '');
    if (cleanText.startsWith('```'))
      cleanText = cleanText.replace(/```\n?/, '').replace(/```$/, '');

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

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const [workerSession, adminSession] = await Promise.all([workerAuth(), adminAuth()]);

    const quizId = params.id;
    const body = await request.json();

    const parsedBody = submitQuizSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid input data', details: parsedBody.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { enrollmentId, answers, timeTaken } = parsedBody.data;

    // Verify enrollment belongs to user
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { course: true },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (
      enrollment.userId !== workerSession?.user?.id &&
      enrollment.userId !== adminSession?.user?.id
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    // Get quiz with questions
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true, lesson: { select: { courseId: true } } },
    });

    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }

    if (quiz.lesson.courseId !== enrollment.courseId) {
      return NextResponse.json(
        { error: 'Quiz does not belong to the enrolled course' },
        { status: 403 },
      );
    }

    // Calculate score
    let correctCount = 0;
    for (const answer of answers) {
      const question = quiz.questions.find((q) => q.id === answer.questionId);
      if (question && question.correctAnswer === answer.selectedAnswer) {
        correctCount++;
      }
    }

    const totalQuestions = quiz.questions.length;
    const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed = score >= quiz.passingScore;

    // Generate AI explanations
    const explanations = await generateExplanations(quiz.questions).catch(
      () => ({}) as Record<string, string>,
    );

    // Enrich answers with explanations for DB storage
    const enrichedAnswers = answers.map((a: { questionId: string; selectedAnswer: string }) => ({
      ...a,
      explanation: explanations[a.questionId] || '',
    }));

    // Check if attempt already exists
    const existingAttempt = await prisma.quizAttempt.findUnique({
      where: {
        enrollmentId_quizId: { enrollmentId, quizId },
      },
    });

    let currentAttemptCount = 1;

    if (existingAttempt) {
      // Hard-enforce attempt limit on submit
      if (quiz.allowedAttempts && existingAttempt.attemptCount > quiz.allowedAttempts) {
        return NextResponse.json(
          {
            error: 'No attempts remaining',
            attemptsUsed: existingAttempt.attemptCount,
            allowedAttempts: quiz.allowedAttempts,
          },
          { status: 403 },
        );
      }

      currentAttemptCount = existingAttempt.attemptCount;

      await prisma.quizAttempt.update({
        where: { id: existingAttempt.id },
        data: {
          answers: enrichedAnswers,
          score,
          timeTaken,
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.quizAttempt.create({
        data: { enrollmentId, quizId, answers: enrichedAnswers, score, timeTaken, attemptCount: 1 },
      });
    }

    // Update enrollment status and score
    // CORE LOGIC: Passing the quiz does NOT complete the course. Attestation required.
    const isLocked = !passed && quiz.allowedAttempts && currentAttemptCount >= quiz.allowedAttempts;

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: isLocked ? 'locked' : 'in_progress',
        score,
        progress: 100,
        ...(isLocked ? { lockedAt: new Date() } : {}),
      },
    });

    // If locked, notify org admins
    if (isLocked) {
      const enrollmentWithDetails = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
          user: { include: { profile: true } },
          course: { include: { lessons: { include: { quiz: true } } } },
        },
      });

      if (enrollmentWithDetails?.user?.organizationId) {
        const workerName =
          enrollmentWithDetails.user.profile?.fullName || enrollmentWithDetails.user.email;
        const courseName = enrollmentWithDetails.course?.title || 'Unknown Course';
        const quizTitle = quiz.title || 'Quiz';
        const orgId = enrollmentWithDetails.user.organizationId;

        // Deduplicated notification
        const existingNotification = await prisma.notification.findFirst({
          where: {
            type: 'QUIZ_RETRY_LIMIT_REACHED',
            resolvedAt: null,
            metadata: { path: ['enrollmentId'], equals: enrollmentId },
          },
        });

        if (!existingNotification) {
          const admins = await prisma.user.findMany({
            where: { organizationId: orgId, role: 'admin' },
            select: { id: true, email: true },
          });

          if (admins.length > 0) {
            await prisma.notification.createMany({
              data: admins.map((admin) => ({
                userId: admin.id,
                type: 'QUIZ_RETRY_LIMIT_REACHED',
                title: 'Quiz Attempts Exhausted',
                message: `${workerName} has used all ${currentAttemptCount} attempts on "${quizTitle}" in course "${courseName}" and requires a retake assignment.`,
                linkUrl: `/dashboard/staff/${enrollmentWithDetails.user.id}`,
                metadata: {
                  enrollmentId,
                  userId: enrollmentWithDetails.user.id,
                  courseId: enrollmentWithDetails.courseId,
                  workerName,
                  quizTitle,
                  courseName,
                  attemptsUsed: currentAttemptCount,
                },
              })),
            });
          }

          // Send emails to admins
          const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
          const { sendQuizLockedEmail } = await import('@/lib/email');
          Promise.allSettled(
            admins.map((admin) =>
              sendQuizLockedEmail(
                admin.email,
                workerName,
                quizTitle,
                courseName,
                currentAttemptCount,
                `${appUrl}/dashboard/staff/${enrollmentWithDetails.user.id}`,
              ).catch((err) =>
                console.error(`Failed to send quiz locked email to ${admin.email}`, err),
              ),
            ),
          );
        }
      }
    }

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
      questions: quiz.questions.map((q) => {
        const userAnswer = answers.find(
          (a: { questionId: string; selectedAnswer: string }) => a.questionId === q.id,
        );
        const optionsArray = Array.isArray(q.options) ? (q.options as any[]) : [];
        const optionTexts = optionsArray.map((opt: any) =>
          typeof opt === 'string' ? opt : opt.text || opt,
        );

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
            text: typeof opt === 'string' ? opt : opt.text || opt,
          })),
          selectedAnswer: selectedLetter,
          correctAnswer: correctLetter,
          explanation: explanations[q.id] || '',
        };
      }),
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
