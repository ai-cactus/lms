// Database types generated from Supabase schema

export type UserRole = 'admin' | 'supervisor' | 'worker';
export type PolicyStatus = 'draft' | 'published' | 'archived';
export type AssignmentStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';

export interface Organization {
    id: string;
    name: string;
    program_type: string;
    license_number?: string;
    created_at: string;
    updated_at: string;
}

export interface User {
    id: string;
    organization_id: string;
    email: string;
    full_name: string;
    role: UserRole;
    supervisor_id?: string;
    deactivated_at?: string;
    created_at: string;
    updated_at: string;
}

export interface Policy {
    id: string;
    organization_id: string;
    title: string;
    version: number;
    file_url: string;
    file_name: string;
    status: PolicyStatus;
    created_at: string;
    updated_at: string;
}

export interface Course {
    id: string;
    policy_id?: string;
    organization_id: string;
    title: string;
    objectives: CourseObjective[];
    lesson_notes: string;
    pass_mark: number;
    attempts_allowed: number;
    carf_standards?: CARFStandard[];
    created_at: string;
    published_at?: string;
    updated_at: string;
}

export interface CourseObjective {
    id: string;
    text: string;
    carf_matched: boolean;
    carf_standard?: string;
}

export interface CARFStandard {
    code: string;
    description: string;
    matched: boolean;
}

export interface QuizQuestion {
    id: string;
    course_id: string;
    question_text: string;
    question_type: 'multiple_choice' | 'true_false' | 'short_answer';
    options: QuizOption[];
    correct_answer: string;
    created_at: string;
}

export interface QuizOption {
    id: string;
    text: string;
}

export interface CourseAssignment {
    id: string;
    course_id: string;
    worker_id: string;
    assigned_by?: string;
    assigned_at: string;
    deadline: string;
    status: AssignmentStatus;
    created_at: string;
    updated_at: string;
}

export interface CourseCompletion {
    id: string;
    assignment_id: string;
    worker_id: string;
    course_id: string;
    completed_at: string;
    quiz_score: number;
    attempt_number: number;
    acknowledgment_signature: string;
    acknowledgment_date: string;
    certificate_url?: string;
    created_at: string;
}

export interface SupervisorConfirmation {
    id: string;
    completion_id: string;
    supervisor_id: string;
    confirmed: boolean;
    reason?: string;
    notes?: string;
    confirmed_at: string;
    created_at: string;
}

export interface RetrainingLog {
    id: string;
    worker_id: string;
    course_id: string;
    reason: string;
    triggered_by?: string;
    triggered_at: string;
    created_at: string;
}

export interface AuditLog {
    id: string;
    organization_id: string;
    user_id?: string;
    action: string;
    entity_type: string;
    entity_id?: string;
    metadata: Record<string, any>;
    timestamp: string;
}

// Joined types for common queries
export interface CourseAssignmentWithCourse extends CourseAssignment {
    course: Course;
}

export interface CourseCompletionWithDetails extends CourseCompletion {
    course: Course;
    worker: User;
    confirmation?: SupervisorConfirmation;
}

export interface UserWithOrganization extends User {
    organization: Organization;
    supervisor?: User;
}
