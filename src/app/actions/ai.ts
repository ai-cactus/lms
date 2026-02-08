'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { VertexAI } from '@google-cloud/vertexai';

// Initialize Vertex AI
const vertexAI = new VertexAI({
    project: process.env.GOOGLE_PROJECT_ID || 'theraptly-lms',
    location: process.env.GOOGLE_LOCATION || 'us-central1',
});

const model = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export type GeneratedCourse = {
    title: string;
    description: string;
    difficulty: string;
    lessons: {
        title: string;
        content: string;
        duration: number;
        quiz: {
            title: string;
            questions: {
                text: string;
                type: string;
                options: string[];
                correctAnswer: string;
            }[];
        };
    }[];
};

// Generate course content from document text
export async function generateCourseFromDocument(
    documentContent: string,
    category: string,
    options?: {
        difficulty?: string;
        lessonCount?: number;
        questionsPerLesson?: number;
    }
): Promise<GeneratedCourse> {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const difficulty = options?.difficulty || 'intermediate';
    const lessonCount = options?.lessonCount || 5;
    const questionsPerLesson = options?.questionsPerLesson || 5;

    const prompt = `You are an expert instructional designer. Based on the following policy document, create a comprehensive training course.

DOCUMENT CONTENT:
${documentContent.slice(0, 15000)}

REQUIREMENTS:
- Category: ${category}
- Difficulty: ${difficulty}
- Number of lessons: ${lessonCount}
- Questions per lesson: ${questionsPerLesson}

Generate a JSON response with this exact structure:
{
  "title": "Course title based on document",
  "description": "2-3 sentence course description",
  "difficulty": "${difficulty}",
  "lessons": [
    {
      "title": "Lesson 1 title",
      "content": "Full lesson content in HTML format with <h3>, <p>, <ul>, <li> tags. Should be comprehensive and educational, 300-500 words.",
      "duration": 10,
      "quiz": {
        "title": "Lesson 1 Quiz",
        "questions": [
          {
            "text": "Question text?",
            "type": "multiple_choice",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correctAnswer": "Option A"
          }
        ]
      }
    }
  ]
}

Make the content educational, engaging, and based directly on the provided document. Include practical examples and key compliance points.`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Failed to parse AI response');
        }

        const courseData = JSON.parse(jsonMatch[0]) as GeneratedCourse;
        return courseData;
    } catch (error) {
        console.error('AI generation error:', error);
        throw new Error('Failed to generate course content');
    }
}

// Generate quiz questions for existing lesson content
export async function generateQuizQuestions(
    lessonContent: string,
    count: number = 5
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    const prompt = `Based on the following lesson content, generate ${count} quiz questions.

LESSON CONTENT:
${lessonContent}

Generate a JSON array of questions:
[
  {
    "text": "Question text?",
    "type": "multiple_choice",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "Option A"
  }
]

Make questions that test understanding of key concepts from the lesson.`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('Failed to parse AI response');
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Quiz generation error:', error);
        throw new Error('Failed to generate quiz questions');
    }
}

// Save generated course to database
export async function saveGeneratedCourse(
    courseData: GeneratedCourse,
    category: string
) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Calculate total duration
    const totalDuration = courseData.lessons.reduce(
        (sum, l) => sum + l.duration,
        0
    );

    const course = await prisma.course.create({
        data: {
            title: courseData.title,
            description: courseData.description,
            category: category,
            duration: totalDuration,
            createdBy: session.user.id,
            lessons: {
                create: courseData.lessons.map((lesson, index) => ({
                    title: lesson.title,
                    content: lesson.content,
                    duration: lesson.duration,
                    order: index + 1,
                    quiz: {
                        create: {
                            title: lesson.quiz.title,
                            passingScore: 70,
                            questions: {
                                create: lesson.quiz.questions.map((q, qIndex) => ({
                                    text: q.text,
                                    type: q.type,
                                    options: q.options,
                                    correctAnswer: q.correctAnswer,
                                    order: qIndex + 1,
                                })),
                            },
                        },
                    },
                })),
            },
        },
        include: {
            lessons: {
                include: { quiz: { include: { questions: true } } },
            },
        },
    });

    return course;
}
