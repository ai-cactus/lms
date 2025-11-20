import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendBulkTrainingReminders } from "@/lib/email";

export async function POST(request: NextRequest) {
    try {
        // Verify cron secret for security
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = await createClient();

        // Get all assignments that need reminders
        // Send reminders for:
        // 1. Assignments due in 7 days
        // 2. Assignments due in 3 days
        // 3. Assignments due in 1 day
        // 4. Overdue assignments (daily)

        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

        const { data: assignments, error } = await supabase
            .from("course_assignments")
            .select(`
        id,
        deadline,
        worker:worker_id(id, full_name, email),
        course:course_id(title)
      `)
            .in("status", ["not_started", "in_progress"])
            .or(
                `deadline.lte.${sevenDaysFromNow.toISOString()},deadline.lt.${now.toISOString()}`
            );

        if (error) throw error;

        const reminders = (assignments || [])
            .filter((a: any) => {
                const deadline = new Date(a.deadline);
                const daysUntil = Math.ceil(
                    (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                );

                // Send reminder if due in 7, 3, or 1 day, or if overdue
                return daysUntil === 7 || daysUntil === 3 || daysUntil === 1 || daysUntil < 0;
            })
            .map((a: any) => ({
                to: Array.isArray(a.worker) ? a.worker[0]?.email : a.worker?.email,
                workerName: Array.isArray(a.worker) ? a.worker[0]?.full_name : a.worker?.full_name,
                courseTitle: Array.isArray(a.course) ? a.course[0]?.title : a.course?.title,
                deadline: new Date(a.deadline),
            }))
            .filter((r) => r.to && r.workerName && r.courseTitle);

        // Send reminders
        const results = await sendBulkTrainingReminders(reminders);

        return NextResponse.json({
            success: true,
            ...results,
        });
    } catch (error: any) {
        console.error("Error sending reminders:", error);
        return NextResponse.json(
            { error: error.message || "Failed to send reminders" },
            { status: 500 }
        );
    }
}
