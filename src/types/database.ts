// Database type definitions

export interface Course {
    id: string;
    title: string;
    description?: string;
    lesson_notes?: string;
    objectives?: CourseObjective[];
    published_at?: string | null;
    created_at?: string;
    updated_at?: string;
    course_type?: 'policy' | 'standard' | 'external';
    policy_version?: string;
    provider_name?: string;
    reference_id?: string;
    deadline_days?: number;
    max_attempts?: number;
    delivery_format?: 'pages' | 'slides';
    quiz_config?: QuizConfig;
    level?: string;
    duration?: number;
    pass_mark?: number;
    learning_objectives?: string[];
    quiz_time_limit_minutes?: number;
}

export interface CourseObjective {
    id: string;
    text: string;
    carf_matched?: boolean;
    carf_standard?: string | null;
}

export type CARFStandard = string;

export interface QuizConfig {
    questions_per_attempt?: number;
    feedback_timing?: 'end' | 'immediate';
    question_order?: 'randomized' | 'fixed';
}
