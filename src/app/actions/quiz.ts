'use server'

import { createClient } from '@/lib/supabase/server'

interface QuizAnswer {
    questionId: string
    questionText: string
    selectedOption: string
    correctAnswer: string
    isCorrect: boolean
}

interface WorkerAttempt {
    id: string
    score: number
    passed: boolean
    attempt_number: number
    completed_at: string
    course?: {
        id: string
        title: string
        version?: number
    }
}

interface AttemptDetails {
    id: string
    score: number
    passed: boolean
    attempt_number: number
    completed_at: string
    course?: {
        id: string
        title: string
        version?: number
    }
    worker?: {
        id: string
        full_name: string
        email: string
    }
}

interface AttemptAnswer {
    id: string
    selected_option_text: string
    is_correct: boolean
    question?: {
        id: string
        question_text: string
        correct_answer: string
    }
}

interface SaveQuizAttemptParams {
    workerId: string
    courseId: string
    assignmentId: string
    score: number
    passed: boolean
    answers: QuizAnswer[]
    metadata?: Record<string, any>
}

/**
 * Save a quiz attempt with all answers to the database
 * Returns the attempt ID if successful
 */
export async function saveQuizAttempt(params: SaveQuizAttemptParams): Promise<{
    success: boolean
    attemptId?: string
    attemptNumber?: number
    error?: string
}> {
    try {
        const supabase = await createClient()
        const { workerId, courseId, assignmentId, score, passed, answers, metadata } = params

        // 1. Get existing attempts count to calculate attempt number
        const { data: existingAttempts, error: countError } = await supabase
            .from('quiz_attempts')
            .select('id')
            .eq('worker_id', workerId)
            .eq('course_id', courseId)
            .eq('assignment_id', assignmentId)

        if (countError) {
            console.error('Error counting attempts:', countError)
            return { success: false, error: countError.message }
        }

        const attemptNumber = (existingAttempts?.length || 0) + 1

        // 2. Insert quiz attempt record
        const { data: attemptData, error: attemptError } = await supabase
            .from('quiz_attempts')
            .insert({
                worker_id: workerId,
                course_id: courseId,
                assignment_id: assignmentId,
                score: score,
                passed: passed,
                attempt_number: attemptNumber,
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                metadata: metadata || {}
            })
            .select('id')
            .single()

        if (attemptError) {
            console.error('Error creating attempt:', attemptError)
            return { success: false, error: attemptError.message }
        }

        const attemptId = attemptData.id

        // 3. Insert all quiz answers
        const answerRecords = answers.map(answer => ({
            attempt_id: attemptId,
            question_id: answer.questionId,
            selected_option_text: answer.selectedOption,
            is_correct: answer.isCorrect
        }))

        const { error: answersError } = await supabase
            .from('quiz_answers')
            .insert(answerRecords)

        if (answersError) {
            console.error('Error saving answers:', answersError)
            // Attempt was created but answers failed - still return success with warning
            return {
                success: true,
                attemptId,
                attemptNumber,
                error: 'Attempt saved but some answers failed to record'
            }
        }

        return {
            success: true,
            attemptId,
            attemptNumber
        }

    } catch (err) {
        console.error('Unexpected error in saveQuizAttempt:', err)
        return {
            success: false,
            error: err instanceof Error ? err.message : 'An unexpected error occurred'
        }
    }
}

/**
 * Get quiz attempts for a specific worker
 */
export async function getWorkerAttempts(workerId: string): Promise<{
    success: boolean
    attempts?: WorkerAttempt[]
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data, error } = await supabase
            .from('quiz_attempts')
            .select(`
                id,
                score,
                passed,
                attempt_number,
                completed_at,
                course:courses (
                    id,
                    title,
                    version
                )
            `)
            .eq('worker_id', workerId)
            .order('completed_at', { ascending: false })

        if (error) {
            return { success: false, error: error.message }
        }

        // Transform Supabase response
        const attempts = (data || []).map((attempt: any) => ({
            ...attempt,
            course: Array.isArray(attempt.course) ? attempt.course[0] : attempt.course
        })) as WorkerAttempt[]

        return { success: true, attempts }

    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
}



/**
 * Get detailed information about a specific attempt including all answers
 */
export async function getAttemptDetails(attemptId: string): Promise<{
    success: boolean
    attempt?: AttemptDetails
    answers?: AttemptAnswer[]
    error?: string
}> {
    try {
        const supabase = await createClient()

        // Get attempt details
        const { data: attemptDataRaw, error: attemptError } = await supabase
            .from('quiz_attempts')
            .select(`
                id,
                score,
                passed,
                attempt_number,
                completed_at,
                course:courses (
                    id,
                    title,
                    version
                ),
                worker:users (
                    id,
                    full_name,
                    email
                )
            `)
            .eq('id', attemptId)
            .single()

        if (attemptError) {
            return { success: false, error: attemptError.message }
        }

        // Transform Supabase response (array -> single object)
        const attempt = {
            ...attemptDataRaw,
            course: Array.isArray(attemptDataRaw.course) ? attemptDataRaw.course[0] : attemptDataRaw.course,
            worker: Array.isArray(attemptDataRaw.worker) ? attemptDataRaw.worker[0] : attemptDataRaw.worker
        } as AttemptDetails

        // Get all answers for this attempt
        const { data: answersDataRaw, error: answersError } = await supabase
            .from('quiz_answers')
            .select(`
                id,
                selected_option_text,
                is_correct,
                question:quiz_questions (
                    id,
                    question_text,
                    correct_answer
                )
            `)
            .eq('attempt_id', attemptId)

        if (answersError) {
            return {
                success: true,
                attempt,
                answers: [],
                error: 'Failed to load answers'
            }
        }

        // Transform answers (array -> single object for question)
        const answers = (answersDataRaw || []).map((a: any) => ({
            ...a,
            question: Array.isArray(a.question) ? a.question[0] : a.question
        })) as AttemptAnswer[]

        return {
            success: true,
            attempt,
            answers
        }

    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
}
