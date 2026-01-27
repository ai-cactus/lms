export interface QuizQuestion {
    id: string;
    questionText: string;
    options: string[];
    correctAnswer: number;
    explanation?: string;
}

export interface QuizConfig {
    title?: string;
    numQuestions?: number;
    difficulty?: string;
    passMark?: string;
    attempts?: number;
    questionType?: string;
    estimatedDuration?: string;
}

export interface CourseData {
    category?: string;
    title?: string;
    description?: string;
    objectives?: string[];
    quizConfig?: QuizConfig;
    difficulty?: string;
    duration?: string;
    contentType?: string;
    targetAudience?: string;
    prerequisites?: string;
    complianceMapping?: string;
    generatedContent?: string; // AI-generated markdown course content
    questions?: QuizQuestion[]; // Array of quiz questions
}
