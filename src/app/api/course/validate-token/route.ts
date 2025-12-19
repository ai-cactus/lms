import { NextRequest, NextResponse } from 'next/server';
import { validateCourseAccessToken } from '@/lib/course-tokens';

export async function POST(request: NextRequest) {
    try {
        const { token } = await request.json();
        
        if (!token) {
            return NextResponse.json({ 
                isValid: false, 
                error: 'Token is required' 
            }, { status: 400 });
        }

        const result = await validateCourseAccessToken(token);
        
        return NextResponse.json(result);
    } catch (error) {
        console.error('Token validation API error:', error);
        return NextResponse.json({ 
            isValid: false, 
            error: 'Failed to validate token' 
        }, { status: 500 });
    }
}
