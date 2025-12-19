import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const supabase = await createClient();
    
    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Apply the DELETE policy for users table
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE POLICY "Admins can delete users in their organization"
            ON users FOR DELETE
            USING (
                is_admin() AND 
                organization_id = get_auth_user_organization_id()
            );
      `
    });

    if (error) {
      console.error('Migration error:', error);
      return NextResponse.json({ 
        error: 'Failed to apply migration', 
        details: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'DELETE policy for users table applied successfully' 
    });

  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
