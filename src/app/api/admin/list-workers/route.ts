import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
    try {
        const supabase = createAdminClient();

        // Get all workers
        const { data: workers, error: workersError } = await supabase
            .from('users')
            .select('id, email, full_name, role, created_at')
            .eq('role', 'worker')
            .order('created_at', { ascending: false });

        if (workersError) {
            return NextResponse.json({
                success: false,
                error: 'Failed to fetch workers: ' + workersError.message
            });
        }

        return NextResponse.json({
            success: true,
            workers: workers || []
        });

    } catch (error: any) {
        console.error('List workers API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Internal server error: ' + error.message 
        }, { status: 500 });
    }
}
