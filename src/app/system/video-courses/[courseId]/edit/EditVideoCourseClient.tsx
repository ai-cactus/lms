'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import VideoCourseForm, { type VideoCourseFormValues } from '../../VideoCourseForm';
import { updateVideoCourse } from '@/app/actions/video-course';
import { parseQuizFile } from '@/lib/video/quiz-import';
import { QuizImportError } from '@/lib/video/types';
import { logger } from '@/lib/logger';
import { isEmptyHtml } from '@/lib/html';

interface Props {
  initial: {
    courseId: string;
    title: string;
    description: string;
    overview: string;
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | '';
    category: string;
    duration: number | null;
    passingScore: number;
    allowedAttempts: number;
    questionCount: number;
    previewExistingUri: string | null;
    previewDurationSeconds: number | null;
    courseVideoExistingUri: string | null;
    courseVideoDurationSeconds: number | null;
  };
}

export default function EditVideoCourseClient({ initial }: Props) {
  const router = useRouter();
  const [alert, setAlert] = useState<{
    variant: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  const handleSubmit = async (
    values: VideoCourseFormValues,
    uploadVideo: (file: File) => Promise<string>,
  ) => {
    setAlert(null);
    try {
      const previewVideoStorageUri = values.previewFile
        ? await uploadVideo(values.previewFile)
        : undefined;

      // Only upload (and replace) the course video when a new file was chosen;
      // otherwise the existing video is kept.
      const courseVideo = values.courseVideoFile
        ? {
            storageUri: await uploadVideo(values.courseVideoFile),
            durationSeconds: values.courseVideoDurationSeconds ?? undefined,
          }
        : undefined;

      // Parse a replacement quiz file (if one was chosen) up front so format
      // errors surface here with row numbers — before any DB write happens.
      // Omitting the file keeps the existing quiz untouched.
      const quiz = values.quizFile
        ? parseQuizFile(values.quizFile.name, await values.quizFile.text())
        : undefined;

      await updateVideoCourse(initial.courseId, {
        title: values.title.trim(),
        description: values.description.trim() || undefined,
        overview: isEmptyHtml(values.overview) ? undefined : values.overview,
        skillLevel: values.skillLevel || undefined,
        category: values.category.trim() || undefined,
        duration: values.duration ?? undefined,
        passingScore: values.passingScore,
        allowedAttempts: values.allowedAttempts,
        previewVideoStorageUri,
        previewVideoDurationSeconds: values.previewDurationSeconds ?? undefined,
        courseVideo,
        quiz,
      });

      router.push('/system/video-courses');
      router.refresh();
    } catch (err) {
      logger.error({
        msg: '[EditVideoCourseClient] update failed',
        err,
        courseId: initial.courseId,
      });
      const rowsInfo =
        err instanceof QuizImportError && err.rows?.length ? ` (rows: ${err.rows.join(', ')})` : '';
      setAlert({
        variant: 'error',
        title: 'Update failed',
        message: (err instanceof Error ? err.message : 'Request failed') + rowsInfo,
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Edit video course</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Update course details, the course video, and the quiz. Replacing a video re-processes it.
          The quiz has {initial.questionCount} question
          {initial.questionCount === 1 ? '' : 's'}; upload a new CSV or JSON file below to replace
          it.
        </p>
      </div>
      {alert && (
        <Alert variant={alert.variant} title={alert.title}>
          {alert.message}
        </Alert>
      )}
      <VideoCourseForm
        mode="edit"
        showQuizPicker
        quizRequired={false}
        currentQuestionCount={initial.questionCount}
        submitLabel="Save changes"
        initialValues={{
          title: initial.title,
          description: initial.description,
          overview: initial.overview,
          skillLevel: initial.skillLevel,
          category: initial.category,
          passingScore: initial.passingScore,
          allowedAttempts: initial.allowedAttempts,
          duration: initial.duration,
          previewExistingUri: initial.previewExistingUri,
          previewFile: null,
          previewDurationSeconds: initial.previewDurationSeconds,
          courseVideoExistingUri: initial.courseVideoExistingUri,
          courseVideoFile: null,
          courseVideoDurationSeconds: initial.courseVideoDurationSeconds,
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
