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

    } catch (err: any) {
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
    } catch (error: any) {
        console.error('Error ensuring courses exist:', error)
        return { error: error.message }
    }
}
