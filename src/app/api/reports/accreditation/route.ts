import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAccreditationReport, formatReportAsMarkdown } from "@/lib/generate-report";

export async function GET() {
    try {
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get user's organization and role
        const { data: userData, error: userError } = await supabase
            .from("users")
            .select("organization_id, role")
            .eq("id", user.id)
            .single();

        if (userError || !userData || userData.role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Generate report
        const reportData = await generateAccreditationReport(userData.organization_id);
        const markdown = formatReportAsMarkdown(reportData);

        // Return as downloadable file
        return new NextResponse(markdown, {
            headers: {
                "Content-Type": "text/markdown",
                "Content-Disposition": `attachment; filename="CARF_Training_Report_${new Date().toISOString().split("T")[0]}.md"`,
            },
        });
    } catch (error: any) {
        console.error("Error generating report:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate report" },
            { status: 500 }
        );
    }
}
