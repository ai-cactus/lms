import { NextResponse } from 'next/server';

/**
 * Standardized API error response.
 * Use this across all API routes for consistent error formatting.
 */
export function apiError(
  message: string,
  status: number,
  code?: string,
): NextResponse<{
  error: string;
  code?: string;
}> {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

/**
 * Standardized API success response.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}
