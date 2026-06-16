'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import VideoCourseForm, { type VideoCourseFormValues } from '../../VideoCourseForm';
import { updateVideoCourse } from '@/app/actions/video-course';
import { logger } from '@/lib/logger';

interface Props {
  initial: {
    courseId: string;
    title: string;
    description: string;
    overview: string;
    skillLevel: 'beginner' | 'intermediate' | 'advanced';
    category: string;
    duration: number | null;
    passingScore: number;
    allowedAttempts: number;
    questionCount: number;
    previewExistingUri: string | null;
    previewDurationSeconds: number | null;
    chapters: {
      id: string;
      title: string;
      lectures: {
        id: string;
        title: string;
        file: File | null;
        durationSeconds: number | null;
        existingVideoStorageUri: string | null;
      }[];
    }[];
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

      const modules = [];
      for (let ci = 0; ci < values.chapters.length; ci++) {
        const chapter = values.chapters[ci];
        const lectures = [];
        for (let li = 0; li < chapter.lectures.length; li++) {
          const lecture = chapter.lectures[li];
          // Skip a brand-new lecture that has no video (existing lectures carry
          // an id and are kept even without a re-upload). Avoids persisting an
          // empty, video-less lesson.
          if (!lecture.id && !lecture.file) continue;
          const videoStorageUri = lecture.file ? await uploadVideo(lecture.file) : undefined;
          lectures.push({
            id: lecture.id,
            title: lecture.title.trim() || `Lecture ${li + 1}`,
            order: li,
            videoStorageUri,
            videoDurationSeconds: lecture.durationSeconds ?? undefined,
          });
        }
        modules.push({
          id: chapter.id,
          title: chapter.title.trim() || `Chapter ${ci + 1}`,
          order: ci,
          lectures,
        });
      }

      await updateVideoCourse(initial.courseId, {
        title: values.title.trim(),
        description: values.description.trim() || undefined,
        overview: values.overview.trim() || undefined,
        skillLevel: values.skillLevel,
        category: values.category.trim() || undefined,
        duration: values.duration ?? undefined,
        passingScore: values.passingScore,
        allowedAttempts: values.allowedAttempts,
        previewVideoStorageUri,
        previewVideoDurationSeconds: values.previewDurationSeconds ?? undefined,
        modules,
      });

      router.push('/system/video-courses');
      router.refresh();
    } catch (err) {
      logger.error({
        msg: '[EditVideoCourseClient] update failed',
        err,
        courseId: initial.courseId,
      });
      setAlert({
        variant: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Edit video course</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Update course details, chapters, lectures and videos. Replacing a video re-processes it.
          The quiz has {initial.questionCount} question
          {initial.questionCount === 1 ? '' : 's'} and is not editable here.
        </p>
      </div>
      {alert && (
        <Alert variant={alert.variant} title={alert.title}>
          {alert.message}
        </Alert>
      )}
      <VideoCourseForm
        mode="edit"
        showQuizPicker={false}
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
          chapters: initial.chapters,
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
