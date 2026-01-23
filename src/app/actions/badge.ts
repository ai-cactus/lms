'use server'

import { createClient } from '@/lib/supabase/server'

// Default badge statement template
const DEFAULT_BADGE_STATEMENT = `This badge confirms that {Employee Full Name} has:

Completed {Course Title}

Passed the required quiz/knowledge check

Signed an attestation confirming understanding and agreement to follow related policies and procedures

Issued by: {Organization Name}
Issued on: {Issued Date}
Badge ID: {Badge ID}`

interface Badge {
    id: string
    assignmentId: string
    workerId: string
    courseId: string
    badgeIdDisplay: string
    statementTemplate: string
    issuingOrganization: string
    issuedAt: string
    verificationUrl: string | null
    requiresAcknowledgement: boolean
    isAcknowledged: boolean
}

interface IssueBadgeParams {
    assignmentId: string
    attestationId: string
}

interface AcknowledgeBadgeParams {
    badgeId: string
    fullNameSignature: string
    agreedCheckbox: boolean
    userAgent?: string
}

/**
 * Generate a unique badge ID
 */
function generateBadgeId(): string {
    const year = new Date().getFullYear()
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase()
    return `BADGE-${year}-${randomPart}`
}

/**
 * Issue a badge for a completed course assignment
 */
export async function issueBadge(params: IssueBadgeParams): Promise<{
    success: boolean
    badgeId?: string
    badge?: Badge
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        // Get assignment and course details
        const { data: assignment, error: assignmentError } = await supabase
            .from('course_assignments')
            .select(`
                id,
                course_id,
                user_id,
                status,
                course:courses(id, title, require_badge_acknowledgement, badge_issuing_organization)
            `)
            .eq('id', params.assignmentId)
            .single()

        if (assignmentError || !assignment) {
            return { success: false, error: 'Assignment not found' }
        }

        // Verify ownership
        if (assignment.user_id !== user.id) {
            return { success: false, error: 'Unauthorized' }
        }

        // Check if badge already exists
        const { data: existingBadge } = await supabase
            .from('badges')
            .select('id')
            .eq('assignment_id', params.assignmentId)
            .maybeSingle()

        if (existingBadge) {
            // Return existing badge
            const badge = await getBadge(existingBadge.id)
            return { success: true, badgeId: existingBadge.id, badge: badge.badge }
        }

        const course = Array.isArray(assignment.course) ? assignment.course[0] : assignment.course

        // Get user profile for organization
        const { data: profile } = await supabase
            .from('users')
            .select('organization_id, organizations(name)')
            .eq('id', user.id)
            .single()

        const organization = Array.isArray(profile?.organizations)
            ? profile.organizations[0]
            : profile?.organizations
        const orgName = course?.badge_issuing_organization || organization?.name || 'Training Organization'

        // Generate badge ID
        const badgeIdDisplay = generateBadgeId()

        // Create badge record
        const badgeData = {
            assignment_id: params.assignmentId,
            worker_id: user.id,
            course_id: assignment.course_id,
            attestation_id: params.attestationId,
            badge_id_display: badgeIdDisplay,
            statement_template: DEFAULT_BADGE_STATEMENT,
            issuing_organization: orgName,
            issued_at: new Date().toISOString(),
            verification_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/verify/badge/${badgeIdDisplay}`,
            requires_acknowledgement: course?.require_badge_acknowledgement || false,
            is_acknowledged: false,
            metadata: {
                issued_by_system: true,
                course_title: course?.title
            }
        }

        const { data: badge, error: insertError } = await supabase
            .from('badges')
            .insert(badgeData)
            .select('*')
            .single()

        if (insertError) {
            console.error('Error creating badge:', insertError)
            return { success: false, error: 'Failed to issue badge' }
        }

        // Update assignment status based on whether acknowledgement is required
        const newStatus = badge.requires_acknowledgement
            ? 'badge_issued'
            : 'completed'

        await supabase
            .from('course_assignments')
            .update({
                status: newStatus,
                progress_percentage: newStatus === 'completed' ? 100 : 95
            })
            .eq('id', params.assignmentId)

        return {
            success: true,
            badgeId: badge.id,
            badge: {
                id: badge.id,
                assignmentId: badge.assignment_id,
                workerId: badge.worker_id,
                courseId: badge.course_id,
                badgeIdDisplay: badge.badge_id_display,
                statementTemplate: badge.statement_template,
                issuingOrganization: badge.issuing_organization,
                issuedAt: badge.issued_at,
                verificationUrl: badge.verification_url,
                requiresAcknowledgement: badge.requires_acknowledgement,
                isAcknowledged: badge.is_acknowledged
            }
        }
    } catch (error) {
        console.error('Error in issueBadge:', error)
        return { success: false, error: 'Failed to issue badge' }
    }
}

/**
 * Get a badge by ID
 */
export async function getBadge(badgeId: string): Promise<{
    success: boolean
    badge?: Badge
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: badge, error } = await supabase
            .from('badges')
            .select('*')
            .eq('id', badgeId)
            .single()

        if (error || !badge) {
            return { success: false, error: 'Badge not found' }
        }

        return {
            success: true,
            badge: {
                id: badge.id,
                assignmentId: badge.assignment_id,
                workerId: badge.worker_id,
                courseId: badge.course_id,
                badgeIdDisplay: badge.badge_id_display,
                statementTemplate: badge.statement_template,
                issuingOrganization: badge.issuing_organization,
                issuedAt: badge.issued_at,
                verificationUrl: badge.verification_url,
                requiresAcknowledgement: badge.requires_acknowledgement,
                isAcknowledged: badge.is_acknowledged
            }
        }
    } catch (error) {
        console.error('Error in getBadge:', error)
        return { success: false, error: 'Failed to fetch badge' }
    }
}

/**
 * Get badge by assignment ID
 */
export async function getBadgeForAssignment(assignmentId: string): Promise<{
    success: boolean
    badge?: Badge
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: badge, error } = await supabase
            .from('badges')
            .select('*')
            .eq('assignment_id', assignmentId)
            .maybeSingle()

        if (error) {
            console.error('Error fetching badge:', error)
            return { success: false, error: 'Failed to fetch badge' }
        }

        if (!badge) {
            return { success: true, badge: undefined }
        }

        return {
            success: true,
            badge: {
                id: badge.id,
                assignmentId: badge.assignment_id,
                workerId: badge.worker_id,
                courseId: badge.course_id,
                badgeIdDisplay: badge.badge_id_display,
                statementTemplate: badge.statement_template,
                issuingOrganization: badge.issuing_organization,
                issuedAt: badge.issued_at,
                verificationUrl: badge.verification_url,
                requiresAcknowledgement: badge.requires_acknowledgement,
                isAcknowledged: badge.is_acknowledged
            }
        }
    } catch (error) {
        console.error('Error in getBadgeForAssignment:', error)
        return { success: false, error: 'Failed to fetch badge' }
    }
}

/**
 * Acknowledge a badge
 */
export async function acknowledgeBadge(params: AcknowledgeBadgeParams): Promise<{
    success: boolean
    acknowledgementId?: string
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

        // Get badge
        const { data: badge, error: badgeError } = await supabase
            .from('badges')
            .select('id, worker_id, assignment_id, is_acknowledged')
            .eq('id', params.badgeId)
            .single()

        if (badgeError || !badge) {
            return { success: false, error: 'Badge not found' }
        }

        // Verify ownership
        if (badge.worker_id !== user.id) {
            return { success: false, error: 'Unauthorized' }
        }

        // Check if already acknowledged
        if (badge.is_acknowledged) {
            return { success: false, error: 'Badge already acknowledged' }
        }

        // Create acknowledgement record
        const acknowledgementData = {
            badge_id: params.badgeId,
            worker_id: user.id,
            full_name_signature: params.fullNameSignature.trim(),
            agreed_checkbox: params.agreedCheckbox,
            acknowledged_at: new Date().toISOString(),
            user_agent: params.userAgent || null,
            metadata: {
                acknowledged_at: new Date().toISOString(),
                user_email: user.email
            }
        }

        const { data: acknowledgement, error: insertError } = await supabase
            .from('badge_acknowledgements')
            .insert(acknowledgementData)
            .select('id')
            .single()

        if (insertError) {
            console.error('Error creating badge acknowledgement:', insertError)
            return { success: false, error: 'Failed to save acknowledgement' }
        }

        // Update badge as acknowledged
        await supabase
            .from('badges')
            .update({ is_acknowledged: true })
            .eq('id', params.badgeId)

        // Update assignment to completed
        await supabase
            .from('course_assignments')
            .update({
                status: 'completed',
                progress_percentage: 100
            })
            .eq('id', badge.assignment_id)

        return { success: true, acknowledgementId: acknowledgement.id }
    } catch (error) {
        console.error('Error in acknowledgeBadge:', error)
        return { success: false, error: 'Failed to acknowledge badge' }
    }
}

/**
 * Get badge details including course and worker info for display
 */
export async function getBadgeDetails(badgeId: string): Promise<{
    success: boolean
    badge?: Badge & {
        courseTitle: string
        workerName: string
    }
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: badge, error } = await supabase
            .from('badges')
            .select(`
                *,
                course:courses(title),
                worker:users!badges_worker_id_fkey(full_name)
            `)
            .eq('id', badgeId)
            .single()

        if (error || !badge) {
            return { success: false, error: 'Badge not found' }
        }

        const course = Array.isArray(badge.course) ? badge.course[0] : badge.course
        const worker = Array.isArray(badge.worker) ? badge.worker[0] : badge.worker

        return {
            success: true,
            badge: {
                id: badge.id,
                assignmentId: badge.assignment_id,
                workerId: badge.worker_id,
                courseId: badge.course_id,
                badgeIdDisplay: badge.badge_id_display,
                statementTemplate: badge.statement_template,
                issuingOrganization: badge.issuing_organization,
                issuedAt: badge.issued_at,
                verificationUrl: badge.verification_url,
                requiresAcknowledgement: badge.requires_acknowledgement,
                isAcknowledged: badge.is_acknowledged,
                courseTitle: course?.title || 'Unknown Course',
                workerName: worker?.full_name || 'Unknown'
            }
        }
    } catch (error) {
        console.error('Error in getBadgeDetails:', error)
        return { success: false, error: 'Failed to fetch badge details' }
    }
}

/**
 * Get badge by its display ID (for verification pages)
 */
export async function getBadgeByDisplayId(badgeIdDisplay: string): Promise<{
    success: boolean
    badge?: Badge & {
        courseTitle: string
        workerName: string
    }
    error?: string
}> {
    try {
        const supabase = await createClient()

        const { data: badge, error } = await supabase
            .from('badges')
            .select(`
                *,
                course:courses(title),
                worker:users!badges_worker_id_fkey(full_name)
            `)
            .eq('badge_id_display', badgeIdDisplay)
            .single()

        if (error || !badge) {
            return { success: false, error: 'Badge not found' }
        }

        const course = Array.isArray(badge.course) ? badge.course[0] : badge.course
        const worker = Array.isArray(badge.worker) ? badge.worker[0] : badge.worker

        return {
            success: true,
            badge: {
                id: badge.id,
                assignmentId: badge.assignment_id,
                workerId: badge.worker_id,
                courseId: badge.course_id,
                badgeIdDisplay: badge.badge_id_display,
                statementTemplate: badge.statement_template,
                issuingOrganization: badge.issuing_organization,
                issuedAt: badge.issued_at,
                verificationUrl: badge.verification_url,
                requiresAcknowledgement: badge.requires_acknowledgement,
                isAcknowledged: badge.is_acknowledged,
                courseTitle: course?.title || 'Unknown Course',
                workerName: worker?.full_name || 'Unknown'
            }
        }
    } catch (error) {
        console.error('Error in getBadgeByDisplayId:', error)
        return { success: false, error: 'Failed to fetch badge' }
    }
}
