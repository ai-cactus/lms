'use server'

import { createClient } from '@/lib/supabase/server'

// Default attestation template text
const DEFAULT_ATTESTATION_TITLE = 'Training Attestation of Understanding and Compliance'

const DEFAULT_ATTESTATION_BODY = `I confirm that I personally completed the training titled {Course Title} and that I passed the required knowledge check.

By signing below, I attest that:

I have read, understood, and can follow the requirements taught in this training.

I will apply this training to my work and follow our organization's policies and procedures related to this topic.

I understand that if I am unsure about any part of this training, I am responsible for asking my supervisor or the compliance team for clarification before acting.

I understand that failure to follow these requirements may lead to corrective action, up to and including termination, in line with organizational policy.

Acknowledgement: My signature confirms this attestation is true and accurate.

Effective date: {Completion Date}`

interface AttestationTemplate {
    id: string
    courseId: string
    title: string
    bodyTemplate: string
    version: number
}

interface SignAttestationParams {
    assignmentId: string
    fullNameSignature: string
    agreedCheckbox: boolean
    userAgent?: string
}

interface Attestation {
    id: string
    assignmentId: string
    workerId: string
    courseId: string
    fullNameSignature: string
    agreedAt: string
    metadata: Record<string, any>
}

/**
 * Get the attestation template for a specific course
 * Falls back to default template if none exists
 */
export async function getAttestationTemplate(courseId: string): Promise<{
    success: boolean
    template?: AttestationTemplate
    error?: string
}> {
    try {
        const supabase = await createClient()

        // Try to get a custom template for this course
        const { data: template, error } = await supabase
            .from('attestation_templates')
            .select('*')
            .eq('course_id', courseId)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (error) {
            console.error('Error fetching attestation template:', error)
        }

        // If no custom template, return default
        if (!template) {
            return {
                success: true,
                template: {
                    id: 'default',
                    courseId,
                    title: DEFAULT_ATTESTATION_TITLE,
                    bodyTemplate: DEFAULT_ATTESTATION_BODY,
                    version: 1
                }
            }
        }

        return {
            success: true,
            template: {
                id: template.id,
                courseId: template.course_id,
                title: template.title,
                bodyTemplate: template.body_template,
                version: template.version
            }
        }
    } catch (error) {
        console.error('Error in getAttestationTemplate:', error)
        return { success: false, error: 'Failed to fetch attestation template' }
    }
}

/**
 * Get assignment details needed for attestation
 */
export async function getAssignmentForAttestation(assignmentId: string): Promise<{
    success: boolean
    assignment?: {
        id: string
        courseId: string
        courseTitle: string
        workerId: string
        workerName: string
        status: string
        quizScore?: number
    }
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        const { data: assignment, error } = await supabase
            .from('course_assignments')
            .select(`
                id,
                course_id,
                user_id,
                status,
                course:courses(id, title),
                worker:users!course_assignments_user_id_fkey(id, full_name)
            `)
            .eq('id', assignmentId)
            .single()

        if (error || !assignment) {
            return { success: false, error: 'Assignment not found' }
        }

        // Verify the user owns this assignment or is admin
        const { data: userProfile } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single()

        const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'
        if (assignment.user_id !== user.id && !isAdmin) {
            return { success: false, error: 'Unauthorized' }
        }

        // Get latest quiz attempt score
        const { data: quizAttempt } = await supabase
            .from('quiz_attempts')
            .select('score')
            .eq('assignment_id', assignmentId)
            .order('completed_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        const course = Array.isArray(assignment.course) ? assignment.course[0] : assignment.course
        const worker = Array.isArray(assignment.worker) ? assignment.worker[0] : assignment.worker

        return {
            success: true,
            assignment: {
                id: assignment.id,
                courseId: course?.id || assignment.course_id,
                courseTitle: course?.title || 'Unknown Course',
                workerId: worker?.id || assignment.user_id,
                workerName: worker?.full_name || 'Unknown',
                status: assignment.status,
                quizScore: quizAttempt?.score
            }
        }
    } catch (error) {
        console.error('Error in getAssignmentForAttestation:', error)
        return { success: false, error: 'Failed to fetch assignment' }
    }
}

/**
 * Sign an attestation for a course assignment
 */
export async function signAttestation(params: SignAttestationParams): Promise<{
    success: boolean
    attestationId?: string
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        // Validate inputs
        if (!params.fullNameSignature || params.fullNameSignature.trim().length < 2) {
            return { success: false, error: 'Please type your full legal name' }
        }

        if (!params.agreedCheckbox) {
            return { success: false, error: 'Please confirm you agree to continue' }
        }

        // Get assignment
        const { data: assignment, error: assignmentError } = await supabase
            .from('course_assignments')
            .select('id, course_id, user_id, status')
            .eq('id', params.assignmentId)
            .single()

        if (assignmentError || !assignment) {
            return { success: false, error: 'Assignment not found' }
        }

        // Verify ownership
        if (assignment.user_id !== user.id) {
            return { success: false, error: 'Unauthorized' }
        }

        // Check if attestation already exists
        const { data: existingAttestation } = await supabase
            .from('attestations')
            .select('id')
            .eq('assignment_id', params.assignmentId)
            .maybeSingle()

        if (existingAttestation) {
            return { success: false, error: 'Attestation already signed for this assignment' }
        }

        // Get template if exists
        const { data: template } = await supabase
            .from('attestation_templates')
            .select('id')
            .eq('course_id', assignment.course_id)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle()

        // Create attestation record
        const attestationData = {
            assignment_id: params.assignmentId,
            worker_id: user.id,
            template_id: template?.id || null,
            course_id: assignment.course_id,
            full_name_signature: params.fullNameSignature.trim(),
            agreed_checkbox: params.agreedCheckbox,
            agreed_at: new Date().toISOString(),
            user_agent: params.userAgent || null,
            metadata: {
                signed_at: new Date().toISOString(),
                user_email: user.email
            }
        }

        const { data: attestation, error: insertError } = await supabase
            .from('attestations')
            .insert(attestationData)
            .select('id')
            .single()

        if (insertError) {
            console.error('Error creating attestation:', insertError)
            return { success: false, error: 'Failed to save attestation' }
        }

        // Update assignment status
        await supabase
            .from('course_assignments')
            .update({ status: 'attestation_signed' })
            .eq('id', params.assignmentId)

        return { success: true, attestationId: attestation.id }
    } catch (error) {
        console.error('Error in signAttestation:', error)
        return { success: false, error: 'Failed to sign attestation' }
    }
}

/**
 * Get an attestation by ID
 */
export async function getAttestation(attestationId: string): Promise<{
    success: boolean
    attestation?: Attestation
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: attestation, error } = await supabase
            .from('attestations')
            .select('*')
            .eq('id', attestationId)
            .single()

        if (error || !attestation) {
            return { success: false, error: 'Attestation not found' }
        }

        return {
            success: true,
            attestation: {
                id: attestation.id,
                assignmentId: attestation.assignment_id,
                workerId: attestation.worker_id,
                courseId: attestation.course_id,
                fullNameSignature: attestation.full_name_signature,
                agreedAt: attestation.agreed_at,
                metadata: attestation.metadata
            }
        }
    } catch (error) {
        console.error('Error in getAttestation:', error)
        return { success: false, error: 'Failed to fetch attestation' }
    }
}

/**
 * Get attestation by assignment ID
 */
export async function getAttestationByAssignment(assignmentId: string): Promise<{
    success: boolean
    attestation?: Attestation
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: attestation, error } = await supabase
            .from('attestations')
            .select('*')
            .eq('assignment_id', assignmentId)
            .maybeSingle()

        if (error) {
            console.error('Error fetching attestation:', error)
            return { success: false, error: 'Failed to fetch attestation' }
        }

        if (!attestation) {
            return { success: true, attestation: undefined }
        }

        return {
            success: true,
            attestation: {
                id: attestation.id,
                assignmentId: attestation.assignment_id,
                workerId: attestation.worker_id,
                courseId: attestation.course_id,
                fullNameSignature: attestation.full_name_signature,
                agreedAt: attestation.agreed_at,
                metadata: attestation.metadata
            }
        }
    } catch (error) {
        console.error('Error in getAttestationByAssignment:', error)
        return { success: false, error: 'Failed to fetch attestation' }
    }
}
