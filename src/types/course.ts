export interface QuizConfig {
    title?: string;
    numQuestions?: number;
    difficulty?: string;
    passMark?: string;
    attempts?: number;
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
}
