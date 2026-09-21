'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';

import SlideDeckShell from '@/components/courses/SlideDeckShell';
import { slideContentClass } from '@/components/courses/slide-content-class';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { updateLessonSlideContent } from '@/app/actions/course';
import { logger } from '@/lib/logger';
import { sanitizeEditableHtml } from '@/lib/sanitize';
import {
  applyTextRunEdits,
  buildEditableSlideHtml,
  scanEditableTextRuns,
  EDITABLE_RUN_ATTRIBUTE,
  type SlideRunEdits,
  type SlideTextRun,
} from '@/lib/slide-editor';
import { splitIntoEditableSections } from '@/lib/slide-splitter';

interface AdminSlideEditorProps {
  lesson: {
    id: string;
    title: string;
    content: string;
    slideContent?: string | null;
    moduleIndex: number;
    totalModules: number;
  };
  onNext: () => void;
  onPrev: () => void;
  isFirst: boolean;
  isLast: boolean;
  onToggleView?: () => void;
}

/** Edited text for every touched section, keyed by section index then run index. */
type DeckEdits = Record<number, SlideRunEdits>;

/**
 * In-place slide editor: the admin navigates the deck and types directly on the
 * rendered slide. Structure is preserved by never exposing it — only text
 * regions are editable, and `applyTextRunEdits` writes back into the section's
 * own source bytes, so wrappers, classes and the locked TELL/SHOW/DO and
 * scenario taxonomy come back untouched.
 *
 * Deliberately NOT a rich-text editor: a region's value is its `textContent`,
 * so no inline styling is authored here and pasted markup — a whole
 * `.rich-slide` div included — flattens to text instead of corrupting the
 * document it was pasted into.
 *
 * ⛔ The whole deck saves at once. Edits live in component state until Save,
 * which reassembles every section — edited, untouched and the whitespace gaps
 * between them — into one string and persists it in a single call, so the
 * lesson is never left half-written. The cost is that unsaved work is lost on
 * close, which is what the dirty badge and the guards below exist to surface.
 *
 * Mounted per lesson (`key={lesson.id}` at the call site): a new lesson is a new
 * deck, so remounting resets the edit state without a resync effect.
 */
export default function AdminSlideEditor({
  lesson,
  onNext,
  onPrev,
  isFirst,
  isLast,
  onToggleView,
}: AdminSlideEditorProps) {
  // Lessons with no generated slides fall back to their article HTML, which
  // splits at its own headings. Saving always writes slideContent — the same
  // detach-on-first-save the learner view already reads through.
  const source = lesson.slideContent || lesson.content || '';

  const sections = useMemo(() => splitIntoEditableSections(source), [source]);

  const runsBySection = useMemo<SlideTextRun[][]>(
    () =>
      sections.map((section) => (section.kind === 'gap' ? [] : scanEditableTextRuns(section.html))),
    [sections],
  );

  /** Gaps are whitespace between authored units: preserved on save, never shown. */
  const pages = useMemo(
    () =>
      sections
        .map((section, sectionIndex) => ({ ...section, sectionIndex }))
        .filter((section) => section.kind !== 'gap'),
    [sections],
  );

  const [edits, setEdits] = useState<DeckEdits>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  /**
   * Keystrokes land here, not in state: re-rendering the slide would replace the
   * `contenteditable` DOM under the caret. Flushed into `edits` whenever the
   * admin leaves the slide, and on save.
   */
  const pendingRef = useRef<Map<number, string>>(new Map());

  const currentPage = pages[pageIndex];
  const currentSectionIndex = currentPage?.sectionIndex ?? -1;

  const editableHtml = useMemo(() => {
    if (!currentPage) return '';
    return sanitizeEditableHtml(
      buildEditableSlideHtml(
        currentPage.html,
        runsBySection[currentPage.sectionIndex],
        edits[currentPage.sectionIndex],
      ),
    );
  }, [currentPage, runsBySection, edits]);

  const flushPending = useCallback((): DeckEdits => {
    const pending = pendingRef.current;
    if (pending.size === 0 || currentSectionIndex < 0) return edits;

    const merged: DeckEdits = {
      ...edits,
      [currentSectionIndex]: {
        ...(edits[currentSectionIndex] ?? {}),
        ...Object.fromEntries(pending),
      },
    };
    pendingRef.current = new Map();
    setEdits(merged);
    return merged;
  }, [edits, currentSectionIndex]);

  const handleInput = (event: React.FormEvent<HTMLDivElement>) => {
    const region = (event.target as HTMLElement).closest(`[${EDITABLE_RUN_ATTRIBUTE}]`);
    if (!region) return;

    const runIndex = Number(region.getAttribute(EDITABLE_RUN_ATTRIBUTE));
    const runCount = runsBySection[currentSectionIndex]?.length ?? 0;
    if (!Number.isInteger(runIndex) || runIndex < 0 || runIndex >= runCount) return;

    pendingRef.current.set(runIndex, region.textContent ?? '');
    setIsDirty(true);
    setJustSaved(false);
  };

  // One region is one run of text. Enter would split it into markup the save
  // path flattens away, so it is blocked rather than silently losing the break.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === 'Enter' &&
      (event.target as HTMLElement).closest(`[${EDITABLE_RUN_ATTRIBUTE}]`)
    ) {
      event.preventDefault();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const region = (event.target as HTMLElement).closest(`[${EDITABLE_RUN_ATTRIBUTE}]`);
    if (!region) return;

    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/\s+/g, ' ');

    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const inserted = document.createTextNode(text);
    range.insertNode(inserted);
    range.setStartAfter(inserted);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    // Programmatic DOM edits fire no input event, so record the region directly.
    const runIndex = Number(region.getAttribute(EDITABLE_RUN_ATTRIBUTE));
    if (Number.isInteger(runIndex)) {
      pendingRef.current.set(runIndex, region.textContent ?? '');
      setIsDirty(true);
      setJustSaved(false);
    }
  };

  const goToSlide = (index: number) => {
    flushPending();
    setPageIndex(index);
  };

  const handleSave = async () => {
    const merged = flushPending();
    setIsSaving(true);
    setSaveError(null);

    const slideContent = sections
      .map((section, index) => {
        const sectionEdits = merged[index];
        if (!sectionEdits) return section.html;
        return applyTextRunEdits(section.html, runsBySection[index], sectionEdits);
      })
      .join('');

    try {
      const result = await updateLessonSlideContent(lesson.id, slideContent);
      if (!result.success) {
        setSaveError(result.error ?? 'Your changes could not be saved.');
        return;
      }
      setIsDirty(false);
      setJustSaved(true);
      logger.info({ msg: '[course] Slide content saved', lessonId: lesson.id });
    } catch (error) {
      // Only genuinely unexpected failures reach here; the action returns every
      // refusal it can explain.
      logger.error({
        msg: '[course] Failed to save slide content',
        err: error,
        lessonId: lesson.id,
      });
      setSaveError('Something went wrong while saving. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  /** Leaving the lesson discards unsaved edits, so confirm before it happens. */
  const guardNavigation = (navigate: () => void) => {
    flushPending();
    if (isDirty) {
      setPendingNavigation(() => navigate);
      return;
    }
    navigate();
  };

  const goPrev = () => {
    if (pageIndex > 0) {
      goToSlide(pageIndex - 1);
      return;
    }
    guardNavigation(onPrev);
  };

  const goNext = () => {
    if (pageIndex < pages.length - 1) {
      goToSlide(pageIndex + 1);
      return;
    }
    guardNavigation(onNext);
  };

  useEffect(() => {
    if (!isDirty) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const headerActions = (
    <>
      {isDirty ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          Unsaved changes
        </span>
      ) : (
        justSaved && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <Check className="size-3.5" aria-hidden="true" />
            Saved
          </span>
        )
      )}
      {onToggleView && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => guardNavigation(onToggleView)}
          disabled={isSaving}
        >
          View as Notes
        </Button>
      )}
      <Button variant="default" size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
        {isSaving ? 'Saving...' : 'Save Slides'}
      </Button>
    </>
  );

  if (!currentPage) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background-secondary p-6">
        <p className="text-sm text-text-muted">This module has no slide content to edit yet.</p>
      </div>
    );
  }

  return (
    <>
      <SlideDeckShell
        moduleTitle={lesson.title?.replace(/^Module\s+\d+[:.]?\s*/i, '')}
        moduleIndex={lesson.moduleIndex}
        totalModules={lesson.totalModules}
        slides={pages}
        activeSlideIndex={pageIndex}
        onSelectSlide={goToSlide}
        headerActions={headerActions}
        banner={
          saveError && (
            <Alert variant="error" className="text-left">
              {saveError}
            </Alert>
          )
        }
        onBack={goPrev}
        onNext={goNext}
        backDisabled={pageIndex === 0 && isFirst}
        nextDisabled={pageIndex === pages.length - 1 && isLast}
      >
        <p className="mb-3 text-xs text-text-muted">
          Click any text on the slide to edit it. Labels such as CONCEPT or SITUATION are fixed.
        </p>
        <div
          className={slideContentClass}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          dangerouslySetInnerHTML={{
            // Sanitised via sanitizeEditableHtml (DOMPurify). Suppressed at the call site
            // rather than disabling the rule, so a future UNSANITISED sink is still caught.
            // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
            __html: editableHtml,
          }}
        />
      </SlideDeckShell>

      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => !open && setPendingNavigation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your slide edits have not been saved. Leaving this module now discards every change
              you have made to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const navigate = pendingNavigation;
                setPendingNavigation(null);
                navigate?.();
              }}
              className="bg-error text-white hover:bg-error/90"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
