import { NextRequest, NextResponse } from 'next/server';
import { getLearnPayload, isLearnPayloadError } from '@/lib/learn/get-learn-payload';

// Fallback transport for the learn experience: the page server-renders the same
// payload, and the client only reaches this route when it was mounted without
// server-provided data.
export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const result = await getLearnPayload(params.id);

  if (isLearnPayloadError(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
