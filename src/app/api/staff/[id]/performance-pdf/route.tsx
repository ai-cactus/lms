import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { StaffPerformancePDF } from '@/components/pdf/StaffPerformancePDF';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // Get authenticated user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify user has access to this staff member (same organization)
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single();

        const { data: staffData } = await supabase
            .from('users')
            .select('id, full_name, email, role, organization_id, created_at')
            .eq('id', id)
            .single();

        if (!staffData || staffData.organization_id !== userData?.organization_id) {
            return NextResponse.json({ error: 'Staff member not found or access denied' }, { status: 404 });
        }

        // Get organization name
        const { data: orgData } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', staffData.organization_id)
            .single();

        // Get all assignments for this worker
        const { data: assignmentsData } = await supabase
            .from("course_assignments")
            .select(`
                id,
                course_id,
                status,
                assigned_at,
                progress_percentage,
                courses(title, objectives, pass_mark)
            `)
            .eq("worker_id", id)
            .order("assigned_at", { ascending: false });

        // Get all completions for this worker
        const { data: completionsData } = await supabase
            .from("course_completions")
            .select("id, course_id, quiz_score, completed_at")
            .eq("worker_id", id);

        // Match completions to assignments
        const assignmentsWithCompletions = (assignmentsData || []).map((assignment: any) => {
            const completion = completionsData?.find(c => c.course_id === assignment.course_id);
            return {
                ...assignment,
                completion: completion || null,
                progress_percentage: assignment.progress_percentage || 0,
                course: {
                    title: assignment.courses?.title || "Unknown Course",
                    difficulty: (assignment.courses?.objectives as any)?.difficulty || "Beginner",
                    pass_mark: assignment.courses?.pass_mark || 80,
                }
            };
        });

        // Calculate stats
        const totalAssigned = assignmentsWithCompletions.length;
        const completed = assignmentsWithCompletions.filter((a: any) => a.status === "completed").length;
        const failed = assignmentsWithCompletions.filter((a: any) => {
            const passMark = a.course.pass_mark;
            return a.status === 'failed' || (a.completion && a.completion.quiz_score < passMark);
        }).length;
        const active = assignmentsWithCompletions.filter((a: any) =>
            a.status === "not_started" || a.status === "in_progress"
        ).length;

        const stats = { totalAssigned, completed, failed, active };

        // Generate PDF
        const pdfBuffer = await renderToBuffer(
            <StaffPerformancePDF
                staffMember={{
                    full_name: staffData.full_name,
                    email: staffData.email,
                    role: staffData.role,
                    created_at: staffData.created_at,
                }}
                assignments={assignmentsWithCompletions}
                stats={stats}
                organizationName={orgData?.name || 'Organization'}
            />
        );

        // Return PDF as downloadable file
        const filename = `Staff_Performance_${staffData.full_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });

    } catch (error) {
        console.error('Error generating staff performance PDF:', error);
        return NextResponse.json(
            { error: 'Failed to generate PDF report' },
            { status: 500 }
        );
    }
}
