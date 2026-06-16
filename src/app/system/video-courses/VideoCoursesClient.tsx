'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { RowActionsMenu } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setVideoCourseStatus } from '@/app/actions/video-course';
import { logger } from '@/lib/logger';
import VideoCourseForm, { type VideoCourseFormValues } from './VideoCourseForm';

// ── Types ──────────────────────────────────────────────────────────────────────

export type MediaStatus = 'processing' | 'ready' | 'failed';

export interface VideoCourseRow {
  id: string;
  title: string;
  durationSeconds: number | null;
  duration: number | null;
  questionCount: number;
  offeringsCount: number;
  enrollmentsCount: number;
  createdAt: string;
  mediaStatus: MediaStatus;
  status: 'draft' | 'published' | 'inactive';
}

interface Props {
  courses: VideoCourseRow[];
}

// ── Status badge ─────────────────────────────────────────────────────────────
function MediaStatusBadge({ status }: { status: MediaStatus }) {
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Processing video…
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center rounded-full bg-error/10 px-2.5 py-1 text-xs font-semibold text-error">
        Processing failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      Ready
    </span>
  );
}

function CourseStatusBadge({ status }: { status: VideoCourseRow['status'] }) {
  if (status === 'inactive') {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
        Inactive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      Active
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null, fallbackMinutes: number | null): string {
  if (seconds != null) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (fallbackMinutes != null) return `${fallbackMinutes} min`;
  return '—';
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function VideoCoursesClient({ courses }: Props) {
  const router = useRouter();

  // While any course is still normalizing its videos, poll the server so the
  // status flips to "Ready" on its own without a manual reload.
  const anyProcessing = courses.some((c) => c.mediaStatus === 'processing');
  useEffect(() => {
    if (!anyProcessing) return;
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [anyProcessing, router]);

  // Bumping this key remounts the create form, resetting it after a successful
  // create — the simplest reliable reset for an uncontrolled file-heavy form.
  const [formKey, setFormKey] = useState(0);
  const [uploadAlert, setUploadAlert] = useState<{
    variant: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Status transition
  const [, startStatusTransition] = useTransition();

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleDeactivate = (course: VideoCourseRow) => {
    if (
      !confirm(
        `Deactivate "${course.title}"?\n\nIt will be hidden from organizations and can no longer be enrolled in, but all enrollment and certificate records are kept. You can reactivate it later.`,
      )
    ) {
      return;
    }
    startStatusTransition(async () => {
      try {
        await setVideoCourseStatus(course.id, 'inactive');
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[VideoCoursesClient] deactivate failed', err, courseId: course.id });
      }
    });
  };

  const handleReactivate = (course: VideoCourseRow) => {
    startStatusTransition(async () => {
      try {
        await setVideoCourseStatus(course.id, 'published');
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[VideoCoursesClient] reactivate failed', err, courseId: course.id });
      }
    });
  };

  const handleCreate = async (
    values: VideoCourseFormValues,
    uploadVideo: (file: File) => Promise<string>,
  ) => {
    setUploadAlert(null);

    try {
      const description = values.description.trim() || undefined;
      const category = values.category.trim() || undefined;
      const passingScore =
        Number.isFinite(values.passingScore) && values.passingScore > 0
          ? values.passingScore
          : undefined;
      const allowedAttempts =
        Number.isFinite(values.allowedAttempts) && values.allowedAttempts > 0
          ? values.allowedAttempts
          : undefined;
      const duration =
        values.duration != null && Number.isFinite(values.duration) && values.duration > 0
          ? values.duration
          : undefined;

      const previewVideoStorageUri = values.previewFile
        ? await uploadVideo(values.previewFile)
        : undefined;

      const modules = [];
      for (let ci = 0; ci < values.chapters.length; ci++) {
        const chapter = values.chapters[ci];
        const lectures = [];
        for (let li = 0; li < chapter.lectures.length; li++) {
          const lecture = chapter.lectures[li];
          if (!lecture.file) continue;
          const videoStorageUri = await uploadVideo(lecture.file);
          lectures.push({
            title: lecture.title.trim() || `Lecture ${li + 1}`,
            order: li,
            videoStorageUri,
            videoDurationSeconds: lecture.durationSeconds ?? undefined,
          });
        }
        if (lectures.length > 0) {
          modules.push({ title: chapter.title.trim() || `Chapter ${ci + 1}`, order: ci, lectures });
        }
      }

      const quizFile = values.quizFile;
      if (!quizFile) throw new Error('[VideoCoursesClient] quizFile missing on create');
      const quizFileText = await quizFile.text();
      const res = await fetch('/api/system/video-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title.trim(),
          description,
          overview: values.overview.trim() || undefined,
          skillLevel: values.skillLevel,
          category,
          passingScore,
          allowedAttempts,
          duration,
          previewVideoStorageUri,
          previewVideoDurationSeconds: values.previewDurationSeconds ?? undefined,
          modules,
          quizFileName: quizFile.name,
          quizFileText,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; rows?: number[] };
        const rowsInfo = data.rows?.length ? ` (rows: ${data.rows.join(', ')})` : '';
        setUploadAlert({
          variant: 'error',
          title: 'Upload failed',
          message: (data.error ?? 'Unknown error') + rowsInfo,
        });
        return;
      }

      setUploadAlert({
        variant: 'success',
        title: 'Course uploaded',
        message:
          'The video course was created. Videos are now being processed for cross-browser playback — the course shows "Processing" in the list below until it\'s ready.',
      });
      // Remount the form to reset all fields back to empty.
      setFormKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      logger.error({ msg: '[VideoCoursesClient] upload failed', err });
      setUploadAlert({
        variant: 'error',
        title: 'Error',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Video Courses</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Upload and manage global self-hosted video courses available across all organizations.
        </p>
      </div>

      {/* ── Upload section ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-background p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-foreground">Upload video course</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Build chapters and lectures, optionally add a preview, and attach a quiz file (CSV or
            JSON) to create a new global course.
          </p>
        </div>

        {uploadAlert && (
          <div className="mb-5">
            <Alert variant={uploadAlert.variant} title={uploadAlert.title}>
              {uploadAlert.message}
            </Alert>
          </div>
        )}

        <VideoCourseForm
          key={formKey}
          mode="create"
          showQuizPicker
          submitLabel="Upload course"
          onSubmit={handleCreate}
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-background">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            Global video courses
            <span className="ml-2 text-sm font-normal text-text-secondary">({courses.length})</span>
          </h2>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Questions</TableHead>
              <TableHead className="hidden md:table-cell">Orgs</TableHead>
              <TableHead className="hidden md:table-cell">Enrolled</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.length > 0 ? (
              courses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{course.title}</span>
                    <span className="block text-xs text-text-secondary md:hidden">
                      {formatDuration(course.durationSeconds, course.duration)} &middot;{' '}
                      {course.questionCount} Qs &middot; {course.enrollmentsCount} enrolled
                    </span>
                  </TableCell>
                  <TableCell>
                    <MediaStatusBadge status={course.mediaStatus} />
                  </TableCell>
                  <TableCell>
                    <CourseStatusBadge status={course.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {formatDuration(course.durationSeconds, course.duration)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{course.questionCount}</TableCell>
                  <TableCell className="hidden md:table-cell">{course.offeringsCount}</TableCell>
                  <TableCell className="hidden md:table-cell">{course.enrollmentsCount}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'Edit',
                          icon: <Pencil className="size-4" />,
                          onSelect: () => router.push(`/system/video-courses/${course.id}/edit`),
                        },
                        course.status === 'inactive'
                          ? {
                              label: 'Reactivate',
                              icon: <RotateCcw className="size-4" />,
                              onSelect: () => handleReactivate(course),
                            }
                          : {
                              label: 'Deactivate',
                              icon: <Trash2 className="size-4" />,
                              variant: 'destructive' as const,
                              onSelect: () => handleDeactivate(course),
                            },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <EmptyTableState
                message="No video courses yet."
                subMessage="Upload a video course using the form above."
                colSpan={9}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
