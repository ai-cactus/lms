import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { CourseStaffPerformancePDF } from '@/components/pdf/CourseStaffPerformancePDF';

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

        // Verify user has access to this course (same organization)
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single();

        const { data: courseData } = await supabase
            .from('courses')
            .select('id, title, organization_id, lesson_notes, pass_mark')
            .eq('id', id)
            .single();

        if (!courseData || courseData.organization_id !== userData?.organization_id) {
            return NextResponse.json({ error: 'Course not found or access denied' }, { status: 404 });
        }

        // Get organization name
        const { data: orgData } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', courseData.organization_id)
            .single();

        // Fetch assignments with user details
        const { data: assignments } = await supabase
            .from("course_assignments")
            .select(`
                id,
                worker_id,
                status,
                progress_percentage,
                users!course_assignments_worker_id_fkey(full_name, role)
            `)
            .eq("course_id", id);

        // Fetch completions for scores
        const { data: completions } = await supabase
            .from("course_completions")
            .select("worker_id, quiz_score, id")
            .eq("course_id", id);

        // Fetch quiz attempts as fallback for scores
        const { data: attempts } = await supabase
            .from("quiz_attempts")
            .select("worker_id, score, id")
            .eq("course_id", id)
            .order("completed_at", { ascending: false });

        // Combine data
        const staffPerformance = (assignments || []).map((assignment: any) => {
            const completion = completions?.find((c) => c.worker_id === assignment.worker_id);
            // Find latest attempt for this worker
            const attempt = attempts?.find((a) => a.worker_id === assignment.worker_id);

            // Use completion score if available, otherwise fallback to attempt score
            const score = completion?.quiz_score ?? attempt?.score ?? null;

            return {
                worker_name: assignment.users?.full_name || "Unknown",
                worker_role: assignment.users?.role,
                score: score,
                status: assignment.status,
                progress: assignment.progress_percentage || 0,
            };
        });

        // Calculate stats
        const totalLearners = staffPerformance.length;
        const completedCount = staffPerformance.filter(s => s.status === 'completed').length;
        const completionRate = totalLearners > 0 ? Math.round((completedCount / totalLearners) * 100) : 0;

        const scores = staffPerformance.filter((s) => s.score !== null).map((s) => s.score as number);
        const averageScore = scores.length > 0
            ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
            : 0;

        // Estimate duration based on word count (avg reading speed 200 wpm)
        const wordCount = courseData.lesson_notes ? courseData.lesson_notes.split(/\s+/).length : 0;
        const averageDuration = Math.ceil(wordCount / 200);

        const courseStats = { totalLearners, completionRate, averageScore, averageDuration };

        // Generate PDF
        const pdfBuffer = await renderToBuffer(
            <CourseStaffPerformancePDF
                courseTitle={courseData.title}
                organizationName={orgData?.name || 'Organization'}
                courseStats={courseStats}
                staffPerformance={staffPerformance}
            />
        );

        // Return PDF as downloadable file
        const filename = `Course_Staff_Performance_${courseData.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });

    } catch (error) {
        console.error('Error generating course staff performance PDF:', error);
        return NextResponse.json(
            { error: 'Failed to generate PDF report' },
            { status: 500 }
        );
    }
}
