'use client';

import { useRef, useState } from 'react';
import { Upload, VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { logger } from '@/lib/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

export type LectureDraft = {
  id?: string; // present when editing an existing lecture
  title: string;
  file: File | null; // a newly chosen replacement/new video
  durationSeconds: number | null;
  existingVideoStorageUri?: string | null; // current video when editing
  _key?: string; // stable render key (client-only, never sent to server)
};

export type ChapterDraft = {
  id?: string; // present when editing an existing chapter
  title: string;
  lectures: LectureDraft[];
  _key?: string; // stable render key (client-only, never sent to server)
};

export interface VideoCourseFormValues {
  title: string;
  description: string;
  overview: string;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  category: string;
  passingScore: number;
  allowedAttempts: number;
  duration: number | null;
  previewExistingUri: string | null; // current preview when editing
  previewFile: File | null; // newly chosen preview
  previewDurationSeconds: number | null;
  chapters: ChapterDraft[];
  quizFile?: File | null; // create-only; set by the form when showQuizPicker is true
}

export interface VideoCourseFormProps {
  mode: 'create' | 'edit';
  initialValues?: Partial<VideoCourseFormValues>;
  onSubmit: (
    values: VideoCourseFormValues,
    uploadVideo: (file: File) => Promise<string>,
  ) => Promise<void>;
  showQuizPicker: boolean; // create => true (quiz required); edit => false
  submitLabel: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds != null) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
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

// ── Initial state seeding ──────────────────────────────────────────────────────

function emptyLecture(): LectureDraft {
  return { title: '', file: null, durationSeconds: null, _key: crypto.randomUUID() };
}

function seedChapters(initial?: Partial<VideoCourseFormValues>): ChapterDraft[] {
  if (initial?.chapters && initial.chapters.length > 0) {
    return initial.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      _key: crypto.randomUUID(),
      lectures:
        c.lectures.length > 0
          ? c.lectures.map((l) => ({
              id: l.id,
              title: l.title,
              file: l.file ?? null,
              durationSeconds: l.durationSeconds ?? null,
              existingVideoStorageUri: l.existingVideoStorageUri ?? null,
              _key: crypto.randomUUID(),
            }))
          : [emptyLecture()],
    }));
  }
  return [{ title: '', lectures: [emptyLecture()], _key: crypto.randomUUID() }];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function VideoCourseForm({
  mode,
  initialValues,
  onSubmit,
  showQuizPicker,
  submitLabel,
}: VideoCourseFormProps) {
  const quizInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);

  // Controlled field state, initialized from props.initialValues.
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [overview, setOverview] = useState(initialValues?.overview ?? '');
  const [skillLevel, setSkillLevel] = useState<'beginner' | 'intermediate' | 'advanced'>(
    initialValues?.skillLevel ?? 'beginner',
  );
  const [category, setCategory] = useState(initialValues?.category ?? '');
  const [passingScore, setPassingScore] = useState<number>(initialValues?.passingScore ?? 70);
  const [allowedAttempts, setAllowedAttempts] = useState<number>(
    initialValues?.allowedAttempts ?? 1,
  );
  const [duration, setDuration] = useState<number | null>(initialValues?.duration ?? null);

  // Existing preview URI (edit mode); read-only here — replacing it just sets
  // previewFile, and the parent decides what to persist.
  const [previewExistingUri] = useState<string | null>(initialValues?.previewExistingUri ?? null);
  const [previewFile, setPreviewFile] = useState<File | null>(initialValues?.previewFile ?? null);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState<number | null>(
    initialValues?.previewDurationSeconds ?? null,
  );

  const [chapters, setChapters] = useState<ChapterDraft[]>(() => seedChapters(initialValues));

  const [quizFile, setQuizFile] = useState<File | null>(initialValues?.quizFile ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Chapter / lecture builder helpers ─────────────────────────────────────────

  const addChapter = () =>
    setChapters((cs) => [
      ...cs,
      { title: '', lectures: [emptyLecture()], _key: crypto.randomUUID() },
    ]);
  const removeChapter = (ci: number) => setChapters((cs) => cs.filter((_, i) => i !== ci));
  const setChapterTitle = (ci: number, value: string) =>
    setChapters((cs) => cs.map((c, i) => (i === ci ? { ...c, title: value } : c)));

  const addLecture = (ci: number) =>
    setChapters((cs) =>
      cs.map((c, i) => (i === ci ? { ...c, lectures: [...c.lectures, emptyLecture()] } : c)),
    );
  const removeLecture = (ci: number, li: number) =>
    setChapters((cs) =>
      cs.map((c, i) => (i === ci ? { ...c, lectures: c.lectures.filter((_, j) => j !== li) } : c)),
    );
  const setLecture = (
    ci: number,
    li: number,
    patchOrUpdater: Partial<LectureDraft> | ((prev: LectureDraft) => Partial<LectureDraft>),
  ) =>
    setChapters((cs) =>
      cs.map((c, i) =>
        i === ci
          ? {
              ...c,
              lectures: c.lectures.map((l, j) =>
                j === li
                  ? {
                      ...l,
                      ...(typeof patchOrUpdater === 'function'
                        ? patchOrUpdater(l)
                        : patchOrUpdater),
                    }
                  : l,
              ),
            }
          : c,
      ),
    );

  // ── Submit gating ─────────────────────────────────────────────────────────────

  const canSubmit =
    title.trim().length > 0 &&
    (!showQuizPicker || quizFile !== null) &&
    (mode === 'create'
      ? chapters.some((c) => c.lectures.some((l) => l.file !== null))
      : chapters.some((c) => c.lectures.some((l) => Boolean(l.id) || l.file !== null)));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const values: VideoCourseFormValues = {
        title,
        description,
        overview,
        skillLevel,
        category,
        passingScore,
        allowedAttempts,
        duration,
        previewExistingUri,
        previewFile,
        previewDurationSeconds,
        chapters,
        quizFile: showQuizPicker ? quizFile : null,
      };
      await onSubmit(values, uploadVideo);
    } catch (err) {
      logger.error({ msg: '[VideoCourseForm] submit failed', err });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          <Input
            name="category"
            placeholder="e.g. Safety"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <Field label="Passing score (%)">
          <Input
            name="passingScore"
            type="number"
            min={1}
            max={100}
            value={passingScore}
            onChange={(e) => setPassingScore(Number(e.target.value))}
            disabled={isSubmitting}
          />
        </Field>

        <Field label="Allowed attempts">
          <Input
            name="allowedAttempts"
            type="number"
            min={1}
            value={allowedAttempts}
            onChange={(e) => setAllowedAttempts(Number(e.target.value))}
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
          value={duration ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setDuration(v === '' ? null : Number(v));
          }}
          disabled={isSubmitting}
        />
      </Field>

      {/* Preview video (optional) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor="previewVideo">
          Preview video (optional)
        </label>
        {mode === 'edit' && previewExistingUri && !previewFile && (
          <p className="text-xs text-text-muted">Current preview: a preview video is attached.</p>
        )}
        <div className="relative flex items-center gap-3 rounded-[10px] border border-dashed border-border p-4">
          <VideoIcon className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="flex-1 truncate text-sm text-text-secondary">
            {previewFile
              ? previewFile.name
              : previewExistingUri
                ? 'Current preview attached'
                : 'MP4 or WebM'}
            {previewFile && previewDurationSeconds != null && (
              <span className="ml-2 text-xs text-text-muted">
                ({formatDuration(previewDurationSeconds)})
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
            {mode === 'edit' && (previewExistingUri || previewFile)
              ? 'Replace video'
              : 'Choose file'}
          </Button>
        </div>
      </div>

      {/* Chapters & lectures builder */}
      <div className="flex flex-col gap-4">
        <label className="text-sm font-medium text-foreground">Chapters &amp; lectures</label>
        {chapters.map((chapter, ci) => (
          <div
            key={chapter._key ?? chapter.id ?? ci}
            className="rounded-[10px] border border-border p-4"
          >
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
            {chapter.lectures.map((lecture, li) => {
              const hasExisting = Boolean(lecture.existingVideoStorageUri) && !lecture.file;
              return (
                <div
                  key={lecture._key ?? lecture.id ?? li}
                  className="mb-2 flex items-center gap-2"
                >
                  <Input
                    className="flex-1"
                    placeholder={`Lecture ${li + 1} title`}
                    value={lecture.title}
                    onChange={(e) => setLecture(ci, li, { title: e.target.value })}
                    disabled={isSubmitting}
                  />
                  {mode === 'edit' && hasExisting ? (
                    <>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        Current video
                      </span>
                      <label className="cursor-pointer text-xs underline text-text-secondary hover:text-foreground">
                        Replace video
                        <input
                          type="file"
                          accept="video/mp4,video/webm"
                          disabled={isSubmitting}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            setLecture(ci, li, { file: f, durationSeconds: null });
                            if (f) {
                              const chosen = f;
                              probeVideoDuration(f).then((d) =>
                                setLecture(ci, li, (prev) =>
                                  prev.file === chosen ? { durationSeconds: d } : {},
                                ),
                              );
                            }
                          }}
                        />
                      </label>
                    </>
                  ) : (
                    <input
                      type="file"
                      accept="video/mp4,video/webm"
                      disabled={isSubmitting}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setLecture(ci, li, { file: f, durationSeconds: null });
                        if (f) {
                          const chosen = f;
                          probeVideoDuration(f).then((d) =>
                            setLecture(ci, li, (prev) =>
                              prev.file === chosen ? { durationSeconds: d } : {},
                            ),
                          );
                        }
                      }}
                    />
                  )}
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
              );
            })}
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

      {/* Quiz file (create-only) */}
      {showQuizPicker && (
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
      )}

      <div>
        <Button type="submit" loading={isSubmitting} disabled={!canSubmit || isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
