import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { parseQuizFile } from '@/lib/video/quiz-import';
import { QuizImportError } from '@/lib/video/types';
import { createVideoCourse } from '@/app/actions/video-course';
import type { CreateVideoModuleInput } from '@/app/actions/video-course';
import { logger } from '@/lib/logger';

interface VideoCoursePayload {
  title?: string;
  description?: string;
  overview?: string;
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  category?: string;
  objectives?: string[];
  duration?: number;
  passingScore?: number;
  allowedAttempts?: number;
  previewVideoStorageUri?: string;
  previewVideoDurationSeconds?: number;
  modules?: CreateVideoModuleInput[];
  quizFileName?: string;
  quizFileText?: string;
}

export async function POST(req: NextRequest) {
  if (!(await verifySystemAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as VideoCoursePayload;

    const title = (body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    if (!Array.isArray(body.modules) || body.modules.length === 0) {
      return NextResponse.json({ error: 'At least one chapter is required' }, { status: 400 });
    }
    const hasLecture = body.modules.some((m) => Array.isArray(m.lectures) && m.lectures.length > 0);
    if (!hasLecture) {
      return NextResponse.json({ error: 'At least one lecture is required' }, { status: 400 });
    }

    if (!body.quizFileName || !body.quizFileText) {
      return NextResponse.json({ error: 'Quiz file is required' }, { status: 400 });
    }
    const quiz = parseQuizFile(body.quizFileName, body.quizFileText);

    const { courseId } = await createVideoCourse({
      title,
      description: body.description?.trim() || undefined,
      overview: body.overview?.trim() || undefined,
      skillLevel: body.skillLevel,
      category: body.category?.trim() || undefined,
      objectives: body.objectives ?? [],
      duration: body.duration && body.duration > 0 ? body.duration : undefined,
      passingScore: Number(body.passingScore ?? 70),
      allowedAttempts: Number(body.allowedAttempts ?? 1),
      previewVideoStorageUri: body.previewVideoStorageUri,
      previewVideoDurationSeconds: body.previewVideoDurationSeconds,
      modules: body.modules,
      quiz,
    });

    return NextResponse.json({ message: 'Video course created', courseId }, { status: 201 });
  } catch (err) {
    if (err instanceof QuizImportError)
      return NextResponse.json({ error: err.message, rows: err.rows }, { status: 400 });
    logger.error({ msg: '[VideoUpload] error', err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
