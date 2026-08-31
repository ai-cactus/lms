'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Step1Category from './steps/Step1Category';
import Step2Modules, {
  type ModuleDraftStatus,
  type Step2ModulesHandle,
} from './steps/Step2Modules';
import Step4Details from './steps/Step4Details';
import Step5Quiz from './steps/Step5Quiz';
import GenerationController from './steps/GenerationController';
import Step8QuizReview from './steps/Step8QuizReview';
import Step9AssignPublish, { isAssignSelectionValid } from './steps/Step9AssignPublish';
import CourseSuccessModal from './CourseSuccessModal';
import ConfirmPublishModal from './ConfirmPublishModal';
import ReviewWarningsModal from './ReviewWarningsModal';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createFullCourse, publishCourse } from '@/app/actions/course';
import { assignCourseToRoles } from '@/app/actions/enrollment';
import type { RenewalCycle, UserRole } from '@/generated/prisma/enums';
import type { RoleAssignmentIntent } from '@/lib/course/pending-assignment';
import { createCustomCategory } from '@/app/actions/categories';
import { analyzeStoredDocument } from '@/app/actions/course-ai';
import { getDocuments } from '@/app/actions/documents';
import { CourseWizardData, CourseWizardModuleDocument, GeneratedCourse } from '@/types/course';
import {
  clearPendingGeneration,
  readPendingGeneration,
  type PendingGenerationJob,
} from '@/lib/course/pending-generation';
import { logger } from '@/lib/logger';
import {
  TOTAL_STEPS,
  getWizardStep,
  stepIndexForKey,
  stepTitle,
  type WizardStepKey,
} from './wizardSteps';

const INITIAL_FORM_DATA: CourseWizardData = {
  categoryId: '',
  title: '',
  description: '',
  difficulty: 'moderate',
  duration: '',
  notesCount: '10',
  completionDeadlineDays: 30,
  objectives: ['', '', ''],
  quizTitle: '',
  quizQuestionCount: '5',
  quizDifficulty: 'medium',
  quizQuestionType: 'multiple_choice',
  quizDuration: '',
  quizPassMark: '80%',
  quizAttempts: '2',
  assignments: [],
  dueDate: '',
  dueTime: '',
  modules: [],
  assignMode: 'roles',
  assignRoles: [],
  dueDeadlineEnabled: false,
  reminders: [
    { value: 7, unit: 'days' },
    { value: 3, unit: 'days' },
    { value: 1, unit: 'days' },
  ],
  recurringEnabled: false,
  renewalCycle: 'none',
};

// Final bump. Earlier versions stored the step as an integer, so every change to
// the ladder silently resumed a draft on the wrong screen — a v2 `step: 7` meant
// "review generated content", but index 7 is now past the end. This version
// stores the step's key, which survives reordering (an unrecognised key restarts
// at the first step), so the ladder can change again without another bump.
const DRAFT_KEY = 'lms_course_wizard_draft_v3';
const SUPERSEDED_DRAFT_KEYS = ['lms_course_wizard_draft', 'lms_course_wizard_draft_v2'];

export default function CourseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDocId = searchParams.get('documentId');
  const analyzedDocId = useRef<string | null>(null);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [pendingJobs, setPendingJobs] = useState<PendingGenerationJob[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const step = getWizardStep(currentStepIndex);
  const [formData, setFormData] = useState<CourseWizardData>(INITIAL_FORM_DATA);
  const [customCategoryName, setCustomCategoryName] = useState('');

  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const modulesStepRef = useRef<Step2ModulesHandle>(null);
  const [moduleDraftStatus, setModuleDraftStatus] = useState<ModuleDraftStatus>('empty');
  const [initialModuleDocument, setInitialModuleDocument] =
    useState<CourseWizardModuleDocument | null>(null);

  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);

  // Publish-review gate (F-051): populated when a generated course is saved as a
  // draft because the server flagged quality warnings.
  const [reviewGate, setReviewGate] = useState<{
    courseId: string;
    title: string;
    warnings: string[];
  } | null>(null);

  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [draftToRestore, setDraftToRestore] = useState<{
    stepKey?: WizardStepKey;
    formData: CourseWizardData;
    generatedContent: GeneratedCourse | null;
  } | null>(null);

  // The deep-linked document (Document Hub → "Create course") seeds the first
  // module's upload slot and prefills the details step.
  useEffect(() => {
    if (!initialDocId) return;

    const loadLinkedDocument = async () => {
      try {
        const fetchedDocs = await getDocuments();
        const linked = fetchedDocs.find((d) => d.id === initialDocId);
        if (linked) {
          setInitialModuleDocument({
            documentId: linked.id,
            fileName: linked.filename,
            fileSize: linked.size,
            mimeType: linked.mimeType,
          });
        }

        if (analyzedDocId.current !== initialDocId) {
          analyzedDocId.current = initialDocId;
          handleAutoAnalyze(initialDocId);
        }
      } catch (e) {
        logger.error({ msg: 'Failed to load documents', err: e });
      }
    };
    loadLinkedDocument();
  }, [initialDocId]);

  useEffect(() => {
    try {
      // A generation left running from an earlier visit is resumed rather than
      // restarted; anything unparseable, stale, or from the pre-module payload
      // shape is discarded by readPendingGeneration.
      const pending = readPendingGeneration();
      if (pending) {
        setPendingJobs(pending.jobs);
      }
      SUPERSEDED_DRAFT_KEYS.forEach((key) => sessionStorage.removeItem(key));

      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.savedAt < 24 * 60 * 60 * 1000) {
          setDraftToRestore(parsed);
          setShowResumeBanner(true);
        } else {
          sessionStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      // Ignored
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (showResumeBanner) return;
      if (step.key === 'category' && formData.categoryId === '') return;

      const draft = {
        stepKey: step.key,
        formData,
        generatedContent,
        savedAt: Date.now(),
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [step.key, formData, generatedContent, showResumeBanner]);

  const handleAutoAnalyze = async (docId: string) => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeStoredDocument(docId);
      if (!result.error) {
        setFormData((prev) => ({
          ...prev,
          title: result.title,
          description: result.description,
          objectives: result.objectives,
          duration: result.duration,
          quizTitle: result.quizTitle,
        }));
      }
    } catch (err) {
      logger.error({ msg: 'Auto-analysis failed', err: err });
    } finally {
      setTimeout(() => {
        setIsAnalyzing(false);
      }, 500);
    }
  };

  const handleGenerationComplete = (content: GeneratedCourse) => {
    setGeneratedContent(content);
    setIsGenerating(false);
    setPendingJobs(null);
    // Flow AI-computed duration back into formData
    if (content.duration) {
      setFormData((prev) => ({ ...prev, duration: content.duration }));
    }
    // Generating and reviewing the result are two sub-phases of ONE step: the
    // controller swaps its own screen once it holds content, and the shell shows
    // the nav row off `isGenerating` — cleared just above — rather than off the
    // step. So there is no step change to make here.
  };

  const handleNext = async () => {
    if (step.key === 'category') {
      const typedName = customCategoryName.trim();
      // A typed name only becomes a category once the admin commits to it by
      // advancing, so the wizard creates it here rather than on every keystroke.
      if (typedName && !formData.categoryId) {
        setIsCreatingCategory(true);
        try {
          const newCategory = await createCustomCategory(typedName);
          setFormData((prev) => ({ ...prev, categoryId: newCategory.id }));
          setCustomCategoryName('');
          setWizardError(null);
          setCurrentStepIndex(currentStepIndex + 1);
        } catch (err) {
          logger.error({ msg: '[course] Failed to create custom category', err });
          setWizardError('Could not create that category. Please try again.');
        } finally {
          setIsCreatingCategory(false);
        }
        return;
      }
    }

    if (step.key === 'modules') {
      // A module that is fully filled in but not yet added is committed here, so
      // advancing never silently discards it.
      const committed =
        moduleDraftStatus === 'complete' ? (modulesStepRef.current?.commitDraft() ?? null) : null;

      // The first module is the single document the later steps generate from,
      // and `commitDraft`'s state update has not landed in `formData` yet.
      const sourceDocId = formData.modules[0]?.documentId ?? committed?.documentId ?? null;

      if (!sourceDocId || analyzedDocId.current === sourceDocId) {
        setCurrentStepIndex(currentStepIndex + 1);
        return;
      }

      setIsAnalyzing(true);

      try {
        const result = await analyzeStoredDocument(sourceDocId);

        if (result.error) {
          logger.error({ msg: '[course] Stored document analysis failed', reason: result.error });
        } else {
          setFormData((prev) => ({
            ...prev,
            title: result.title,
            description: result.description,
            objectives: result.objectives,
            duration: result.duration,
            quizTitle: result.quizTitle,
          }));
          analyzedDocId.current = sourceDocId;
        }
      } catch (err) {
        logger.error({ msg: 'Error analyzing stored doc:', err: err });
      } finally {
        setIsAnalyzing(false);
        setCurrentStepIndex(currentStepIndex + 1);
      }
      return;
    }

    if (currentStepIndex < TOTAL_STEPS - 1) {
      // The generation step owns the viewport (no nav row) from the moment it
      // mounts, so the flag flips before the step changes. The `!generatedContent`
      // guard is load-bearing: without it, going Back to Quiz and forward again
      // would raise the flag while the controller mounts with `initialContent`
      // and therefore never reports `onGeneratingChange(true)` — hiding the nav
      // row permanently, with no way off the step.
      if (step.key === 'quiz' && !generatedContent) {
        setIsGenerating(true);
      }
      setWizardError(null);
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      if (!formData.title?.trim()) {
        setWizardError('Please enter a course title');
        return;
      }
      if (!generatedContent?.modules || generatedContent.modules.length === 0) {
        setWizardError(
          `No course content generated. Please go back to the ${stepTitle('generate')} step.`,
        );
        return;
      }

      setWizardError(null);
      setShowConfirmModal(true);
    }
  };

  const handlePublish = async (reviewerName: string) => {
    setIsPublishing(true);
    setShowConfirmModal(false);
    logger.info({ msg: `Course reviewed and published by ${reviewerName}` });

    // Step 9 targets either whole roles or named individuals, never both: the
    // email list only reaches createFullCourse in email mode, and the role
    // targets are assigned right after the course exists — unless the quality
    // gate holds it back, in which case the server parks the intent instead.
    const assignMode = formData.assignMode;
    const roleTargets = formData.assignRoles as UserRole[];
    const targetsRoles = assignMode === 'roles' && roleTargets.length > 0;
    // An explicit deadline only counts while the deadline toggle is on.
    const dueDate = formData.dueDeadlineEnabled ? formData.dueDate : '';
    const dueTime = formData.dueDeadlineEnabled ? formData.dueTime : '';
    // Built once so the intent parked for a held-back draft cannot drift from
    // the assignment performed when the course publishes immediately.
    const roleAssignmentSettings = {
      dueWindowDays: formData.completionDeadlineDays,
      remindersEnabled: formData.reminders.length > 0,
      reminderDaysBefore: formData.reminders.map((reminder) => reminder.value),
      renewalCycle: formData.recurringEnabled ? (formData.renewalCycle as RenewalCycle) : 'none',
    } satisfies Omit<RoleAssignmentIntent, 'roles'>;

    try {
      const result = await createFullCourse({
        categoryId: formData.categoryId,
        title: formData.title,
        description: formData.description,
        difficulty: formData.difficulty,
        duration: formData.duration,
        modules: generatedContent?.modules || [],
        courseModules: generatedContent?.courseModules?.map((mod) => ({
          title: mod.title,
          objective: mod.objective,
          completionDeadlineDays: mod.completionDeadlineDays,
          documentId: mod.documentId,
        })),
        objectives: formData.objectives || [],
        quiz: generatedContent?.quiz || [],
        assignments: assignMode === 'email' ? formData.assignments || [] : [],
        // Only used if the quality gate holds the course back — the immediate
        // publish path assigns the roles below instead.
        roleAssignment: targetsRoles
          ? { roles: roleTargets, ...roleAssignmentSettings }
          : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        dueTime,
        quizTitle: formData.quizTitle,
        quizPassMark: formData.quizPassMark,
        quizQuestionType: formData.quizQuestionType,
        quizAttempts: formData.quizAttempts,
        quizDuration: formData.quizDuration,
        quizDifficulty: formData.quizDifficulty,
        rawArticleMeta: generatedContent?.rawArticleMeta || undefined,
        rawArticleMarkdown: generatedContent?.rawArticleMarkdown || undefined,
        rawSlidesJson: generatedContent?.rawSlidesJson || undefined,
        rawJudgeJson: generatedContent?.rawJudgeJson || undefined,
        rawQuizJson: generatedContent?.rawQuizJson || undefined,
        rawCourseJson: generatedContent?.rawCourseJson || undefined,
      });

      if (result.success) {
        // Capture the title before resetting form state so the follow-up modal
        // can still display it.
        const courseTitle = formData.title;

        // Role targeting is a separate write from course creation, so a failure
        // here must not lose the published course — it is surfaced as a banner
        // and the admin can re-assign from the training dashboard. A course held
        // back by the quality gate assigns nobody yet: enrolling would email
        // learners about a draft, so publishCourse replays the parked intent
        // once the warnings are acknowledged.
        let roleAssignmentFailed = false;
        let roleAssignmentReason: string | null = null;
        if (!result.reviewRequired && targetsRoles) {
          try {
            const assignResult = await assignCourseToRoles(result.courseId, roleTargets, {
              dueDate: dueDate || null,
              dueTime: dueTime || null,
              ...roleAssignmentSettings,
            });
            // A refusal (billing gate, invalid deadline) is returned rather than
            // thrown, so it carries a reason worth showing instead of the
            // generic banner.
            if (assignResult.refusedReason) {
              roleAssignmentFailed = true;
              roleAssignmentReason = assignResult.refusedReason;
              logger.warn({
                msg: '[course] Published course was not assigned to roles — refused',
                courseId: result.courseId,
                reason: assignResult.refusedReason,
              });
            }
          } catch (assignError) {
            roleAssignmentFailed = true;
            logger.error({
              msg: '[course] Failed to assign published course to roles',
              courseId: result.courseId,
              err: assignError,
            });
          }
        }

        // Reset all wizard state so the next course creation starts fresh
        setCurrentStepIndex(0);
        setFormData(INITIAL_FORM_DATA);
        setCustomCategoryName('');
        setGeneratedContent(null);
        setWizardError(null);
        setIsGenerating(false);
        setIsAnalyzing(false);
        setModuleDraftStatus('empty');
        setInitialModuleDocument(null);
        analyzedDocId.current = null;
        setPendingJobs(null);
        clearPendingGeneration();
        sessionStorage.removeItem(DRAFT_KEY);

        if (result.reviewRequired) {
          // Saved as a draft — surface the quality warnings and require an
          // explicit acknowledgement before publishing.
          setReviewGate({
            courseId: result.courseId,
            title: courseTitle,
            warnings: result.qualityWarnings,
          });
        } else {
          setCreatedCourseId(result.courseId);
        }

        if (roleAssignmentFailed) {
          setWizardError(
            roleAssignmentReason
              ? `Course published, but it was not assigned to the selected roles. ${roleAssignmentReason} You can assign it from the training dashboard.`
              : 'Course published, but assigning it to the selected roles failed. You can assign it from the training dashboard.',
          );
        }
      } else {
        setWizardError('Failed to create course. Please try again.');
      }
    } catch (error) {
      logger.error({ msg: 'Error submitting course:', err: error });
      setWizardError('An unexpected error occurred. Please try again.');
    } finally {
      setIsPublishing(false);
    }
  };

  // Publish-review gate: publish a flagged draft after the admin acknowledges
  // its quality warnings.
  const handlePublishAnyway = async () => {
    if (!reviewGate) return;
    setIsPublishing(true);
    try {
      const result = await publishCourse(reviewGate.courseId, { acknowledgeWarnings: true });
      if (result && 'success' in result && result.success === false) {
        setWizardError(result.error);
        return;
      }
      const publishedId = reviewGate.courseId;
      setReviewGate(null);
      setCreatedCourseId(publishedId);
      if (result.assignmentFailed) {
        setWizardError(
          'Course published, but assigning it to the selected recipients failed. You can assign it from the training dashboard.',
        );
      }
    } catch (error) {
      logger.error({ msg: 'Error publishing course with warnings:', err: error });
      setWizardError('An unexpected error occurred. Please try again.');
    } finally {
      setIsPublishing(false);
    }
  };

  // Publish-review gate: leave the course as a draft for later review.
  const handleKeepDraft = () => {
    setReviewGate(null);
    router.push('/dashboard/training');
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    } else {
      router.back();
    }
  };

  const renderStep = () => {
    switch (step.key) {
      case 'category':
        return (
          <Step1Category
            selectedCategoryId={formData.categoryId}
            onSelect={(id) => setFormData({ ...formData, categoryId: id })}
            customCategoryName={customCategoryName}
            onCustomCategoryNameChange={setCustomCategoryName}
          />
        );
      case 'modules':
        return (
          <Step2Modules
            // Re-keyed so the deep-linked document, which resolves after mount,
            // seeds the first upload slot.
            key={initialModuleDocument?.documentId ?? 'no-linked-document'}
            ref={modulesStepRef}
            modules={formData.modules}
            onModulesChange={(modules) => setFormData((prev) => ({ ...prev, modules }))}
            onDraftStatusChange={setModuleDraftStatus}
            initialDocument={initialModuleDocument}
          />
        );
      case 'details':
        return (
          <Step4Details
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      case 'quiz':
        return (
          <Step5Quiz
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      // One step, two sub-phases: the controller runs a job per module, then
      // swaps itself for the review of the aggregated result. Deliberately
      // unkeyed — remounting it would re-run `useMultiJobStatus` with
      // `enabled: !hasInitialContent` and can start a second generation.
      case 'generate':
        return (
          <GenerationController
            data={formData}
            initialContent={generatedContent}
            onComplete={handleGenerationComplete}
            pendingJobs={pendingJobs}
            onGeneratingChange={setIsGenerating}
          />
        );
      case 'quizReview':
        return (
          <Step8QuizReview
            data={formData}
            quiz={generatedContent?.quiz}
            rawContext={generatedContent?.rawArticleMarkdown}
            onQuizUpdate={(newQuiz) =>
              setGeneratedContent((prev) => (prev ? { ...prev, quiz: newQuiz } : null))
            }
          />
        );
      case 'assign':
        return (
          <Step9AssignPublish
            data={formData}
            onChange={(field, val) => setFormData((prev) => ({ ...prev, [field]: val }))}
          />
        );
    }
  };

  const isNextDisabled = (): boolean => {
    switch (step.key) {
      case 'category': {
        if (!formData.categoryId && !customCategoryName.trim()) return true;
        if (isCreatingCategory) return true;
        return false;
      }
      case 'modules': {
        if (isAnalyzing) return true;
        // A half-filled module would be lost on Next, so it blocks; a complete one
        // is committed by `handleNext` before advancing.
        if (moduleDraftStatus === 'partial') return true;
        if (moduleDraftStatus === 'complete') return false;
        return formData.modules.length === 0;
      }
      case 'details': {
        if (!formData.title?.trim()) return true;
        if (!formData.description?.trim()) return true;

        if (!formData.notesCount) return true;
        if (!formData.completionDeadlineDays || formData.completionDeadlineDays < 1) return true;
        if (!formData.objectives || formData.objectives.length < 3) return true;
        if (formData.objectives.some((obj) => !obj.trim())) return true;
        return false;
      }
      case 'quiz': {
        if (!formData.quizTitle?.trim()) return true;
        if (!formData.quizQuestionCount) return true;

        const passMark = parseInt(formData.quizPassMark?.replace('%', '') || '0');
        if (!formData.quizPassMark || isNaN(passMark) || passMark <= 0) return true;
        return false;
      }
      case 'generate': {
        if (!generatedContent?.modules || generatedContent.modules.length === 0) return true;
        return false;
      }
      case 'quizReview': {
        if (!generatedContent?.quiz || generatedContent.quiz.length === 0) return true;
        return false;
      }
      case 'assign': {
        return !isAssignSelectionValid(formData);
      }
    }
  };

  const navRow = (
    <div className="flex w-full shrink-0 items-center justify-between gap-4">
      <Button
        variant="outline"
        onClick={handleBack}
        disabled={isPublishing}
        className="h-[52px] rounded-[12px] border-[1.5px] border-[#d2d5db] px-8 text-base font-semibold tracking-[0.36px] text-[#454353] md:h-[56px] md:px-10 md:text-[18px]"
      >
        Back
      </Button>
      <Button
        variant="default"
        onClick={handleNext}
        disabled={
          isNextDisabled() || isGenerating || isPublishing || isAnalyzing || isCreatingCategory
        }
        loading={isGenerating || isPublishing || isAnalyzing || isCreatingCategory}
        className="h-[52px] rounded-[12px] px-8 text-base font-semibold tracking-[0.36px] md:h-[56px] md:px-10 md:text-[18px]"
      >
        {currentStepIndex === TOTAL_STEPS - 1 ? 'Publish Course' : 'Next Step'}
      </Button>
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-body">
      <header className="flex h-[72px] w-full shrink-0 items-stretch border-b border-black/10 bg-background md:h-[106px]">
        <div className="flex w-[140px] shrink-0 items-center justify-center border-r border-black/10 px-2 md:w-[218px]">
          <Logo variant="blue" size="md" />
        </div>
        <div className="flex flex-1 items-center justify-between gap-4 pl-4 pr-5 md:pl-[30px] md:pr-[60px]">
          <span className="truncate text-sm font-medium tracking-[0.38px] text-[#3e3e3e] md:text-[19px]">
            Step {currentStepIndex + 1} of {TOTAL_STEPS}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              if (currentStepIndex > 0) {
                setShowExitConfirm(true);
              } else {
                router.push('/dashboard/courses');
              }
            }}
            className="h-auto px-2 py-1 text-base font-bold tracking-[0.4px] text-[#0d0d12] md:text-[20px]"
          >
            Exit
          </Button>
        </div>
      </header>

      <div className="h-1.5 w-full shrink-0 bg-[#dbdbdb] md:h-2">
        <div
          className="h-full rounded-r-[210px] bg-primary transition-[width] duration-300 ease-[ease]"
          style={{ width: `${((currentStepIndex + 1) / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      <main className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
        {showResumeBanner && (
          <div className="mx-auto mt-6 flex w-full max-w-[1080px] items-center justify-between gap-4 rounded-lg border border-[#BEE3F8] bg-[#EBF4FF] p-4">
            <div>
              <h3 className="m-0 mb-1 text-base text-[#2B6CB0]">Resume your draft?</h3>
              <p className="m-0 text-sm text-[#2C5282]">
                We found an unsaved course creation draft from your current session.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  sessionStorage.removeItem(DRAFT_KEY);
                  setShowResumeBanner(false);
                  setDraftToRestore(null);
                }}
              >
                Start Fresh
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  if (draftToRestore) {
                    setFormData(draftToRestore.formData);
                    setCurrentStepIndex(stepIndexForKey(draftToRestore.stepKey));
                    setGeneratedContent(draftToRestore.generatedContent);
                    // The first module's document has already been analysed for
                    // the details step, so restoring must not re-run it.
                    analyzedDocId.current = draftToRestore.formData.modules[0]?.documentId ?? null;
                  }
                  setShowResumeBanner(false);
                  setDraftToRestore(null);
                }}
              >
                Resume Draft
              </Button>
            </div>
          </div>
        )}

        {step.ownsViewport ? (
          <>
            {renderStep()}
            {!isGenerating && (
              // The nav row tracks the width of whatever the controller rendered:
              // the review sub-phase is a wide multi-column layout, but the
              // failure card is narrow and centred like every other step.
              <div
                className={`mx-auto flex w-full shrink-0 flex-col gap-3 px-5 py-6 ${
                  generatedContent ? 'max-w-[1400px]' : 'max-w-[1120px]'
                }`}
              >
                {wizardError && (
                  <div className="rounded-md bg-[#fed7d7] px-4 py-2.5 text-center text-sm text-[#e53e3e]">
                    {wizardError}
                  </div>
                )}
                {navRow}
              </div>
            )}
          </>
        ) : (
          <div className={`mx-auto flex w-full flex-col gap-14 px-5 ${step.columnClass}`}>
            {renderStep()}

            {wizardError && (
              <div className="rounded-md bg-[#fed7d7] px-4 py-2.5 text-center text-sm text-[#e53e3e]">
                {wizardError}
              </div>
            )}

            {navRow}
          </div>
        )}

        {createdCourseId && (
          <CourseSuccessModal
            isOpen={true}
            onClose={() => setCreatedCourseId(null)}
            courseId={createdCourseId}
            courseTitle={formData.title}
          />
        )}

        {reviewGate && (
          <ReviewWarningsModal
            isOpen={true}
            onClose={handleKeepDraft}
            onPublishAnyway={handlePublishAnyway}
            onSaveDraft={handleKeepDraft}
            courseTitle={reviewGate.title}
            warnings={reviewGate.warnings}
            isPublishing={isPublishing}
          />
        )}

        <ConfirmPublishModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handlePublish}
          courseTitle={formData.title}
          isPublishing={isPublishing}
        />

        {showExitConfirm && (
          <Dialog open onOpenChange={(open) => !open && setShowExitConfirm(false)}>
            <DialogContent className="rounded-[16px] p-6 sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-[#0d0d12]">
                  Exit course creation?
                </DialogTitle>
                <DialogDescription className="text-[15px] leading-relaxed text-[#4A5568]">
                  You have unsaved progress. If you exit now, your work will be lost.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-3 gap-3 sm:justify-end">
                <Button
                  variant="outline"
                  className="h-[44px] rounded-[10px] border-[1.5px] border-[#e5e7ea] px-6 font-semibold text-[#454353]"
                  onClick={() => setShowExitConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  className="h-[44px] rounded-[10px] px-6 font-semibold"
                  onClick={() => {
                    sessionStorage.removeItem(DRAFT_KEY);
                    router.push('/dashboard/courses');
                  }}
                >
                  Exit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </div>
  );
}
