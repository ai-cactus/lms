import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { SAMPLE_QUIZ_CSV, SAMPLE_QUIZ_JSON } from '@/lib/video/samples';

export async function GET(req: NextRequest) {
  if (!(await verifySystemAdminCookie()))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const format = req.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const body = format === 'json' ? SAMPLE_QUIZ_JSON : SAMPLE_QUIZ_CSV;
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'json' ? 'application/json' : 'text/csv',
      'Content-Disposition': `attachment; filename="quiz-sample.${format}"`,
    },
  });
}
