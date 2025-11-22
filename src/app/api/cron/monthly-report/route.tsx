import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendMonthlyPerformanceEmail } from '@/lib/email';
import { getDetailedOrgPerformance } from '@/app/actions/analytics';
import { renderToBuffer } from '@react-pdf/renderer';
import { MonthlyPerformancePDF } from '@/components/pdf/MonthlyPerformancePDF';

export async function GET(req: NextRequest) {
    // Verify Cron Secret
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const supabase = createAdminClient();

    try {
        // 1. Get all orgs with monthly reports enabled
        const { data: settingsList, error: settingsError } = await supabase
            .from('organization_settings')
            .select('organization_id, additional_recipients')
            .eq('monthly_report_enabled', true);

        if (settingsError) throw settingsError;

        if (!settingsList || settingsList.length === 0) {
            return NextResponse.json({ message: 'No organizations have monthly reports enabled.' });
        }

        const results = [];
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const monthName = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

        // 2. Process each organization
        for (const settings of settingsList) {
            const orgId = settings.organization_id;

            // Fetch Org Name
            const { data: org } = await supabase
                .from('organizations')
                .select('name')
                .eq('id', orgId)
                .single();

            const orgName = org?.name || 'Organization';

            // Fetch Admins/Supervisors emails
            const { data: admins } = await supabase
                .from('users')
                .select('email')
                .eq('organization_id', orgId)
                .in('role', ['admin', 'supervisor']);

            const adminEmails = admins?.map(u => u.email).filter(Boolean) as string[] || [];
            const recipients = [...new Set([...adminEmails, ...(settings.additional_recipients || [])])];

            if (recipients.length === 0) continue;

            // Fetch Detailed Performance Data
            // We want data for the last month ideally, but getDetailedOrgPerformance defaults to all time if no date
            // Let's pass date filters for last month
            const startDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).toISOString();
            const endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).toISOString();

            const { data: perfData } = await getDetailedOrgPerformance(orgId, { startDate, endDate });

            if (!perfData) continue;

            // Prepare Data for Email
            const topCourses = perfData.coursePerformance
                .sort((a, b) => b.passRate - a.passRate)
                .slice(0, 5)
                .map(c => ({ title: c.courseTitle, completionRate: c.passRate }));

            const strugglingObjectives = perfData.strugglingObjectives
                .map(o => ({ text: o.objectiveText, incorrectRate: o.incorrectPercentage }));

            const retrainingStats = {
                workersInRetraining: perfData.retrainingStats.workersInRetraining,
                completionRate: perfData.retrainingStats.retrainingCompletionRate
            };

            // Generate PDF
            const pdfBuffer = await renderToBuffer(
                // @ts-ignore
                <MonthlyPerformancePDF
                    organizationName={orgName}
                    month={monthName}
                    coursePerformance={perfData.coursePerformance.map(c => ({
                        title: c.courseTitle,
                        passRate: c.passRate,
                        avgScore: c.avgScore
                    }))}
                    strugglingObjectives={strugglingObjectives}
                    retrainingStats={retrainingStats}
                />
            );

            // Send Email with Attachment
            const emailResult = await sendMonthlyPerformanceEmail({
                to: recipients,
                organizationName: orgName,
                month: monthName,
                topCourses,
                strugglingObjectives,
                retrainingStats,
                reportUrl: `${process.env.NEXT_PUBLIC_APP_URL}/admin/analytics/performance`,
                attachments: [
                    {
                        filename: `Performance_Report_${monthName.replace(' ', '_')}.pdf`,
                        content: pdfBuffer
                    }
                ]
            });

            results.push({ orgId, success: emailResult.success });
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error('Cron job failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
