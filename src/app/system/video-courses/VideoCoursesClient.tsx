'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Upload, VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
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
import { deleteVideoCourse } from '@/app/actions/video-course';
import { logger } from '@/lib/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VideoCourseRow {
  id: string;
  title: string;
  durationSeconds: number | null;
  duration: number | null;
  questionCount: number;
  offeringsCount: number;
  enrollmentsCount: number;
  createdAt: string;
}

interface Props {
  courses: VideoCourseRow[];
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
  const formRef = useRef<HTMLFormElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const quizInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [title, setTitle] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [quizFile, setQuizFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadAlert, setUploadAlert] = useState<{
    variant: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Delete transition
  const [, startDeleteTransition] = useTransition();

  // ── Handlers ────────────────────────────────────────────────────────────────

  const canSubmit = title.trim().length > 0 && videoFile !== null && quizFile !== null;

  const handleDelete = (course: VideoCourseRow) => {
    if (
      !confirm(
        `Delete "${course.title}"?\n\nThis will permanently remove the video course and cannot be undone.`,
      )
    ) {
      return;
    }
    startDeleteTransition(async () => {
      try {
        await deleteVideoCourse(course.id);
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[VideoCoursesClient] delete failed', err, courseId: course.id });
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setUploadAlert(null);

    const form = e.currentTarget;
    const fd = new FormData(form);

    try {
      const res = await fetch('/api/system/video-courses', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        let errData: { error?: string; rows?: number[] } = {};
        try {
          errData = (await res.json()) as typeof errData;
        } catch {
          // ignore JSON parse failure
        }
        const rowsInfo = errData.rows?.length ? ` (rows: ${errData.rows.join(', ')})` : '';
        setUploadAlert({
          variant: 'error',
          title: 'Upload failed',
          message: (errData.error ?? 'Unknown error') + rowsInfo,
        });
        return;
      }

      setUploadAlert({
        variant: 'success',
        title: 'Course uploaded',
        message: 'The video course was created successfully.',
      });

      // Reset form
      setTitle('');
      setVideoFile(null);
      setQuizFile(null);
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      logger.error({ msg: '[VideoCoursesClient] upload fetch failed', err });
      setUploadAlert({
        variant: 'error',
        title: 'Network error',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setIsSubmitting(false);
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
            Provide a video file and a quiz file (CSV or JSON) to create a new global course.
          </p>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Title */}
          <Field label="Title">
            <Input
              name="title"
              placeholder="e.g. Fire Safety Fundamentals"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <Input
              name="description"
              placeholder="Short description (optional)"
              disabled={isSubmitting}
            />
          </Field>

          {/* Two-column row: Category + Passing score + Allowed attempts */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Category">
              <Input name="category" placeholder="e.g. Safety" disabled={isSubmitting} />
            </Field>

            <Field label="Passing score (%)">
              <Input
                name="passingScore"
                type="number"
                min={1}
                max={100}
                defaultValue={70}
                disabled={isSubmitting}
              />
            </Field>

            <Field label="Allowed attempts">
              <Input
                name="allowedAttempts"
                type="number"
                min={1}
                defaultValue={1}
                disabled={isSubmitting}
              />
            </Field>
          </div>

          {/* Duration */}
          <Field label="Duration (minutes, optional)">
            <Input
              name="duration"
              type="number"
              min={1}
              placeholder="e.g. 30"
              disabled={isSubmitting}
            />
          </Field>

          {/* Video file */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="videoFile">
              Video file <span className="text-error">*</span>
            </label>
            <div className="relative flex items-center gap-3 rounded-[10px] border border-dashed border-border p-4">
              <VideoIcon className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="flex-1 truncate text-sm text-text-secondary">
                {videoFile ? videoFile.name : 'MP4 or WebM'}
              </span>
              <input
                ref={videoInputRef}
                id="videoFile"
                type="file"
                name="video"
                accept="video/mp4,video/webm"
                required
                disabled={isSubmitting}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => videoInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose file
              </Button>
            </div>
          </div>

          {/* Quiz file */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="quizFile">
              Quiz file (CSV or JSON) <span className="text-error">*</span>
            </label>
            <div className="relative flex items-center gap-3 rounded-[10px] border border-dashed border-border p-4">
              <Upload className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="flex-1 truncate text-sm text-text-secondary">
                {quizFile ? quizFile.name : '.csv or .json'}
              </span>
              <input
                ref={quizInputRef}
                id="quizFile"
                type="file"
                name="quiz"
                accept=".csv,.json"
                required
                disabled={isSubmitting}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => setQuizFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => quizInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose file
              </Button>
            </div>
            <div className="flex gap-4 text-xs text-text-secondary">
              <a
                href="/api/system/video-courses/sample?format=csv"
                className="underline hover:text-foreground"
              >
                Download CSV sample
              </a>
              <a
                href="/api/system/video-courses/sample?format=json"
                className="underline hover:text-foreground"
              >
                Download JSON sample
              </a>
            </div>
          </div>

          {/* Alerts */}
          {uploadAlert && (
            <Alert variant={uploadAlert.variant} title={uploadAlert.title}>
              {uploadAlert.message}
            </Alert>
          )}

          <div>
            <Button type="submit" loading={isSubmitting} disabled={!canSubmit || isSubmitting}>
              Upload course
            </Button>
          </div>
        </form>
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
                          label: 'Delete',
                          icon: <Trash2 className="size-4" />,
                          variant: 'destructive',
                          onSelect: () => handleDelete(course),
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
                colSpan={7}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
