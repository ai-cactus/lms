'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CARFCourse } from '@/lib/carf-courses'

export type DeleteCourseState = {
    message?: string
    error?: string
    success?: boolean
}

export async function deleteCourse(courseId: string): Promise<DeleteCourseState> {
    try {
        const supabase = await createClient()

        // 1. Verify authentication
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { error: 'Not authenticated' }
        }

        // 2. Perform deletion
        const { error } = await supabase
            .from('courses')
            .delete()
            .eq('id', courseId)

        if (error) {
            console.error('Error deleting course:', error)
            return { error: 'Failed to delete course: ' + error.message }
        }

        // 3. Revalidate path
        revalidatePath('/admin/courses')
        return { success: true, message: 'Course deleted successfully' }

    } catch (err) {
        console.error('Unexpected error:', err)
        return { error: 'An unexpected error occurred' }
    }
}




export async function ensureCoursesExist(courses: CARFCourse[]): Promise<{ idMap?: Record<string, string>, error?: string }> {
    try {
        const supabase = await createClient()
        const idMap: Record<string, string> = {}

        // Check auth
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return { error: 'Not authenticated' }

        for (const course of courses) {
            // Check if course exists by reference_id
            const { data: existing } = await supabase
                .from('courses')
                .select('id')
                .eq('reference_id', course.id)
                .single()

            if (existing) {
                idMap[course.id] = existing.id
            } else {
                // Create new course
                const { data: newCourse, error: createError } = await supabase
                    .from('courses')
                    .insert({
                        title: course.title,
                        description: course.description,
                        reference_id: course.id,
                        course_type: 'standard',
                        provider_name: 'CARF',
                        delivery_format: 'pages',
                        // Default values for required fields
                        category: 'General',
                        duration_minutes: 60
                    })
                    .select('id')
                    .single()

                if (createError) {
                    console.error(`Failed to create course ${course.title}:`, createError)
                    // Continue or fail? Let's log and continue, but this might cause issues for this specific course
                    continue
                }

                if (newCourse) {
                    idMap[course.id] = newCourse.id
                }
            }
        }

        return { idMap }
    } catch (error) {
        console.error('Error ensuring courses exist:', error)
        return { error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function updateCourseProgress(assignmentId: string, progress: number): Promise<{ success?: boolean, error?: string }> {
    try {
        const supabase = await createClient()

        // 1. Verify authentication
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { error: 'Not authenticated' }
        }

        // 2. Validate progress
        const validProgress = Math.min(100, Math.max(0, Math.round(progress)))

        // 3. Fetch current state and course info
        const { data: current } = await supabase
            .from('course_assignments')
            .select('progress_percentage, status, course_id')
            .eq('id', assignmentId)
            .single()

        if (!current) {
            return { error: 'Assignment not found' }
        }

        // If already completed, don't change anything (or maybe just ensure progress is 100?)
        if (current.status === 'completed') {
            return { success: true }
        }

        if ((current.progress_percentage || 0) > validProgress) {
            // Don't downgrade progress
            return { success: true }
        }

        // 4. Check if course has quiz questions
        // If it has questions, we DO NOT complete it via progress (must pass quiz)
        const { count } = await supabase
            .from('quiz_questions')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', current.course_id)

        const hasQuiz = count !== null && count > 0

        // Only mark as completed if 100% AND no quiz
        const newStatus = (validProgress === 100 && !hasQuiz) ? 'completed' : 'in_progress'

        const { error } = await supabase
            .from('course_assignments')
            .update({
                progress_percentage: validProgress,
                status: newStatus
            })
            .eq('id', assignmentId)

        if (error) {
            console.error('Error updating progress:', error)
            return { error: 'Failed to update progress' }
        }

        return { success: true }
    } catch (error) {
        console.error('Error updating progress:', error)
        return { error: 'An unexpected error occurred' }
    }
}
