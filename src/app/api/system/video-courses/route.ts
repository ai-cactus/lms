import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { uploadFile } from '@/lib/storage';
import { parseQuizFile } from '@/lib/video/quiz-import';
import { QuizImportError } from '@/lib/video/types';
import { createVideoCourse } from '@/app/actions/video-course';
import { logger } from '@/lib/logger';

const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES ?? 500 * 1024 * 1024);
const ALLOWED = ['video/mp4', 'video/webm'];

export async function POST(req: NextRequest) {
  if (!(await verifySystemAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const video = form.get('video');
    const quizFile = form.get('quiz');
    const title = String(form.get('title') ?? '').trim();
    const passingScore = Number(form.get('passingScore') ?? 70);
    const allowedAttempts = Number(form.get('allowedAttempts') ?? 1);
    const description = String(form.get('description') ?? '').trim() || undefined;
    const category = String(form.get('category') ?? '').trim() || undefined;
    const duration = form.get('duration') ? Number(form.get('duration')) : undefined;

    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    if (!(video instanceof File))
      return NextResponse.json({ error: 'Missing video file' }, { status: 400 });
    if (!ALLOWED.includes(video.type))
      return NextResponse.json({ error: 'Video must be MP4 or WebM' }, { status: 400 });
    if (video.size > MAX_VIDEO_BYTES)
      return NextResponse.json(
        { error: `Video exceeds ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB` },
        { status: 413 },
      );
    if (!(quizFile instanceof File))
      return NextResponse.json({ error: 'Missing quiz file' }, { status: 400 });

    const quiz = parseQuizFile(quizFile.name, await quizFile.text()); // throws QuizImportError on bad data

    const buffer = Buffer.from(await video.arrayBuffer());
    const safe = video.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `system/videos/${Date.now()}-${safe}`;
    const { storageUri } = await uploadFile(key, buffer, video.type);

    const { courseId } = await createVideoCourse({
      title,
      description,
      category,
      duration,
      passingScore,
      allowedAttempts,
      videoStorageUri: storageUri,
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
