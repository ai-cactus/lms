'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, Upload, VideoIcon } from 'lucide-react';
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

/**
 * Reads a video file's duration (seconds) in the browser by loading just its
 * metadata into a detached <video> element. Works for MP4/WebM without any
 * server dependency. Resolves null if the browser can't decode it.
 */
function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      const done = (val: number | null) => {
        URL.revokeObjectURL(url);
        resolve(val);
      };
      video.onloadedmetadata = () => {
        const d = video.duration;
        done(Number.isFinite(d) && d > 0 ? Math.round(d) : null);
      };
      video.onerror = () => done(null);
      video.src = url;
    } catch {
      resolve(null);
    }
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function VideoCoursesClient({ courses }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const quizInputRef = useRef<HTMLInputElement>(null);

  // While any course is still normalizing its videos, poll the server so the
  // status flips to "Ready" on its own without a manual reload.
  const anyProcessing = courses.some((c) => c.mediaStatus === 'processing');
  useEffect(() => {
    if (!anyProcessing) return;
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [anyProcessing, router]);

  // Upload form state
  const [title, setTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [skillLevel, setSkillLevel] = useState<'beginner' | 'intermediate' | 'advanced'>(
    'beginner',
  );

  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState<number | null>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);

  type LectureDraft = { title: string; file: File | null; durationSeconds: number | null };
  type ChapterDraft = { title: string; lectures: LectureDraft[] };
  const [chapters, setChapters] = useState<ChapterDraft[]>([
    { title: '', lectures: [{ title: '', file: null, durationSeconds: null }] },
  ]);

  const [quizFile, setQuizFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadAlert, setUploadAlert] = useState<{
    variant: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Delete transition
  const [, startDeleteTransition] = useTransition();

  // ── Chapter / lecture builder helpers ─────────────────────────────────────────

  const addChapter = () =>
    setChapters((cs) => [
      ...cs,
      { title: '', lectures: [{ title: '', file: null, durationSeconds: null }] },
    ]);
  const removeChapter = (ci: number) => setChapters((cs) => cs.filter((_, i) => i !== ci));
  const setChapterTitle = (ci: number, value: string) =>
    setChapters((cs) => cs.map((c, i) => (i === ci ? { ...c, title: value } : c)));

  const addLecture = (ci: number) =>
    setChapters((cs) =>
      cs.map((c, i) =>
        i === ci
          ? { ...c, lectures: [...c.lectures, { title: '', file: null, durationSeconds: null }] }
          : c,
      ),
    );
  const removeLecture = (ci: number, li: number) =>
    setChapters((cs) =>
      cs.map((c, i) => (i === ci ? { ...c, lectures: c.lectures.filter((_, j) => j !== li) } : c)),
    );
  const setLecture = (ci: number, li: number, patch: Partial<LectureDraft>) =>
    setChapters((cs) =>
      cs.map((c, i) =>
        i === ci
          ? { ...c, lectures: c.lectures.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : c,
      ),
    );

  async function uploadVideo(file: File): Promise<string> {
    const fd = new FormData();
    fd.set('video', file);
    const res = await fetch('/api/system/video-courses/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Video upload failed');
    }
    const data = (await res.json()) as { storageUri: string };
    return data.storageUri;
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const canSubmit =
    title.trim().length > 0 &&
    quizFile !== null &&
    chapters.some((c) => c.lectures.some((l) => l.file !== null));

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

    try {
      // Read the remaining (uncontrolled) form fields so they make it into the
      // JSON payload alongside the controlled title/overview/skill-level state.
      const fd = new FormData(formRef.current ?? undefined);
      const description = String(fd.get('description') ?? '').trim() || undefined;
      const category = String(fd.get('category') ?? '').trim() || undefined;
      const passingScoreRaw = Number(fd.get('passingScore'));
      const passingScore =
        Number.isFinite(passingScoreRaw) && passingScoreRaw > 0 ? passingScoreRaw : undefined;
      const allowedAttemptsRaw = Number(fd.get('allowedAttempts'));
      const allowedAttempts =
        Number.isFinite(allowedAttemptsRaw) && allowedAttemptsRaw > 0
          ? allowedAttemptsRaw
          : undefined;
      const durationRaw = Number(fd.get('duration'));
      const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;

      const previewVideoStorageUri = previewFile ? await uploadVideo(previewFile) : undefined;

      const modules = [];
      for (let ci = 0; ci < chapters.length; ci++) {
        const chapter = chapters[ci];
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

      const quizFileText = await quizFile!.text();
      const res = await fetch('/api/system/video-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description,
          overview: overview.trim() || undefined,
          skillLevel,
          category,
          passingScore,
          allowedAttempts,
          duration,
          previewVideoStorageUri,
          previewVideoDurationSeconds: previewDurationSeconds ?? undefined,
          modules,
          quizFileName: quizFile!.name,
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
      setTitle('');
      setOverview('');
      setSkillLevel('beginner');
      setPreviewFile(null);
      setPreviewDurationSeconds(null);
      setChapters([{ title: '', lectures: [{ title: '', file: null, durationSeconds: null }] }]);
      setQuizFile(null);
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      logger.error({ msg: '[VideoCoursesClient] upload failed', err });
      setUploadAlert({
        variant: 'error',
        title: 'Error',
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
            Build chapters and lectures, optionally add a preview, and attach a quiz file (CSV or
            JSON) to create a new global course.
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

          {/* Overview */}
          <Field label="Overview">
            <textarea
              name="overview"
              className="min-h-[120px] w-full rounded-[10px] border border-border p-3 text-sm"
              placeholder="Long-form course overview"
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>

          {/* Skill level */}
          <Field label="Skill level">
            <select
              name="skillLevel"
              className="h-11 w-full rounded-[10px] border border-border px-3 text-sm"
              value={skillLevel}
              onChange={(e) => setSkillLevel(e.target.value as typeof skillLevel)}
              disabled={isSubmitting}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
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

          {/* Preview video (optional) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="previewVideo">
              Preview video (optional)
            </label>
            <div className="relative flex items-center gap-3 rounded-[10px] border border-dashed border-border p-4">
              <VideoIcon className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="flex-1 truncate text-sm text-text-secondary">
                {previewFile ? previewFile.name : 'MP4 or WebM'}
                {previewFile && previewDurationSeconds != null && (
                  <span className="ml-2 text-xs text-text-muted">
                    ({formatDuration(previewDurationSeconds, null)})
                  </span>
                )}
              </span>
              <input
                ref={previewInputRef}
                id="previewVideo"
                type="file"
                accept="video/mp4,video/webm"
                disabled={isSubmitting}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPreviewFile(f);
                  setPreviewDurationSeconds(null);
                  if (f) probeVideoDuration(f).then(setPreviewDurationSeconds);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose file
              </Button>
            </div>
          </div>

          {/* Chapters & lectures builder */}
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-foreground">Chapters &amp; lectures</label>
            {chapters.map((chapter, ci) => (
              <div key={ci} className="rounded-[10px] border border-border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Input
                    placeholder={`Chapter ${ci + 1} title`}
                    value={chapter.title}
                    onChange={(e) => setChapterTitle(ci, e.target.value)}
                    disabled={isSubmitting}
                  />
                  {chapters.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeChapter(ci)}
                      disabled={isSubmitting}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {chapter.lectures.map((lecture, li) => (
                  <div key={li} className="mb-2 flex items-center gap-2">
                    <Input
                      className="flex-1"
                      placeholder={`Lecture ${li + 1} title`}
                      value={lecture.title}
                      onChange={(e) => setLecture(ci, li, { title: e.target.value })}
                      disabled={isSubmitting}
                    />
                    <input
                      type="file"
                      accept="video/mp4,video/webm"
                      disabled={isSubmitting}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setLecture(ci, li, { file: f, durationSeconds: null });
                        if (f)
                          probeVideoDuration(f).then((d) =>
                            setLecture(ci, li, { durationSeconds: d }),
                          );
                      }}
                    />
                    {chapter.lectures.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLecture(ci, li)}
                        disabled={isSubmitting}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addLecture(ci)}
                  disabled={isSubmitting}
                >
                  + Add lecture
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addChapter}
              disabled={isSubmitting}
            >
              + Add chapter
            </Button>
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
              <TableHead>Status</TableHead>
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
                colSpan={8}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
