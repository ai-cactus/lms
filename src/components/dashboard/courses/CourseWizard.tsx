'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Step1Category from './steps/Step1Category';
import Step2Documents from './steps/Step2Documents';
import Step3Details from './steps/Step3Details';
import Step4Quiz from './steps/Step4Quiz';
import Step5Review from './steps/Step5Review';
import Step6QuizReview from './steps/Step6QuizReview';
import Step7Publish from './steps/Step7Publish';
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
import PhiErrorModal from './PhiErrorModal';
import { createFullCourse, publishCourse } from '@/app/actions/course';
import { analyzeStoredDocument } from '@/app/actions/course-ai';
import { getDocuments, uploadDocument, deleteDocument } from '@/app/actions/documents';
import { CourseWizardData, GeneratedCourse, CourseDocument } from '@/types/course';
import { logger } from '@/lib/logger';

const INITIAL_FORM_DATA: CourseWizardData = {
  categoryId: '',
  title: '',
  description: '',
  difficulty: 'moderate',
  duration: '',
  notesCount: '10',
  objectives: ['', '', ''],
  quizTitle: '',
  quizQuestionCount: '15',
  quizDifficulty: 'medium',
  quizQuestionType: 'multiple_choice',
  quizDuration: '',
  quizPassMark: '80%',
  quizAttempts: '2',
  assignments: [],
  dueDate: '',
  dueTime: '',
};

const DRAFT_KEY = 'lms_course_wizard_draft';

export default function CourseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDocId = searchParams.get('documentId');
  const analyzedDocId = useRef<string | null>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const totalSteps = 7;
  const [formData, setFormData] = useState<CourseWizardData>(INITIAL_FORM_DATA);

  const [documents, setDocuments] = useState<CourseDocument[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [isScanningPhi, setIsScanningPhi] = useState(false);
  const [showPhiError, setShowPhiError] = useState(false);
  const [phiReason, setPhiReason] = useState<string | undefined>(undefined);
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
    step: number;
    formData: CourseWizardData;
    generatedContent: GeneratedCourse | null;
    selectedDocId: string | null;
  } | null>(null);

  useEffect(() => {
    const loadDocs = async () => {
      try {
        const fetchedDocs = await getDocuments();
        setDocuments((prevDocs) =>
          fetchedDocs.map((d) => {
            const existing = prevDocs.find((p) => p.id === d.id);
            return {
              id: d.id,
              name: d.filename,
              type: d.filename.endsWith('.pdf') ? 'pdf' : 'docx',
              status: 'analyzed',
              selected: existing ? existing.selected : initialDocId ? d.id === initialDocId : false,
            };
          }),
        );

        if (initialDocId && analyzedDocId.current !== initialDocId) {
          analyzedDocId.current = initialDocId;
          handleAutoAnalyze(initialDocId);
        }
      } catch (e) {
        logger.error({ msg: 'Failed to load documents', err: e });
      }
    };
    loadDocs();
  }, [initialDocId]);

  useEffect(() => {
    try {
      localStorage.removeItem('lms_pending_generation');

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
      if (currentStep === 1 && formData.categoryId === '') return;

      const draft = {
        step: currentStep,
        formData,
        generatedContent,
        selectedDocId: documents.find((d) => d.selected)?.id || null,
        savedAt: Date.now(),
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [currentStep, formData, generatedContent, documents, showResumeBanner]);

  const handleAutoAnalyze = async (docId: string) => {
    setIsAnalyzing(true);
    setAnalysisProgress(30);
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
      setAnalysisProgress(100);
    } catch (err) {
      logger.error({ msg: 'Auto-analysis failed', err: err });
    } finally {
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisProgress(0);
      }, 500);
    }
  };

  const handleToggleSelect = (id: string) => {
    setDocuments((docs) =>
      docs.map((doc) =>
        doc.id === id ? { ...doc, selected: !doc.selected } : { ...doc, selected: false },
      ),
    );
  };

  const handleDeleteWizardDoc = async (id: string) => {
    // Optimistic removal so the UI responds instantly
    setDocuments((docs) => docs.filter((d) => d.id !== id));
    try {
      await deleteDocument(id);
    } catch (err) {
      // Re-fetch list so the doc reappears if the server call failed
      logger.error({ msg: 'Failed to delete document from wizard:', err: err });
      const refreshed = await getDocuments();
      setDocuments(
        refreshed.map((d) => ({
          id: d.id,
          name: d.filename,
          type: d.filename.endsWith('.pdf') ? 'pdf' : 'docx',
          status: 'analyzed' as const,
          selected: false,
        })),
      );
    }
  };

  const handleGenerationComplete = (content: GeneratedCourse) => {
    setGeneratedContent(content);
    setIsGenerating(false);
    // Flow AI-computed duration back into formData
    if (content.duration) {
      setFormData((prev) => ({ ...prev, duration: content.duration }));
    }
  };

  const handleNext = async () => {
    if (currentStep === 2) {
      const selectedDoc = documents.find((d) => d.selected);
      if (!selectedDoc) {
        setCurrentStep(currentStep + 1);
        return;
      }

      if (analyzedDocId.current !== selectedDoc.id) {
        setIsAnalyzing(true);
        setAnalysisProgress(30);

        try {
          const result = await analyzeStoredDocument(selectedDoc.id);
          setAnalysisProgress(100);

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
            analyzedDocId.current = selectedDoc.id;
          }
        } catch (err) {
          logger.error({ msg: 'Error analyzing stored doc:', err: err });
        } finally {
          setIsAnalyzing(false);
          setAnalysisProgress(0);
          setCurrentStep(currentStep + 1);
        }
      } else {
        setCurrentStep(currentStep + 1);
      }
      return;
    }

    if (currentStep < totalSteps) {
      if (currentStep === 5 && !generatedContent) {
        setIsGenerating(true);
      }
      setCurrentStep(currentStep + 1);
    } else {
      if (!formData.title?.trim()) {
        setPublishError('Please enter a course title');
        return;
      }
      if (!generatedContent?.modules || generatedContent.modules.length === 0) {
        setPublishError('No course content generated. Please go back to Step 5.');
        return;
      }

      setPublishError(null);
      setShowConfirmModal(true);
    }
  };

  const handlePublish = async (reviewerName: string) => {
    setIsPublishing(true);
    setShowConfirmModal(false);
    logger.info({ msg: `Course reviewed and published by ${reviewerName}` });

    const selectedDocId = documents.find((d) => d.selected)?.id;

    try {
      const result = await createFullCourse({
        categoryId: formData.categoryId,
        title: formData.title,
        description: formData.description,
        difficulty: formData.difficulty,
        duration: formData.duration,
        modules: generatedContent?.modules || [],
        objectives: formData.objectives || [],
        quiz: generatedContent?.quiz || [],
        assignments: formData.assignments || [],
        dueDate: formData.dueDate ? new Date(formData.dueDate) : undefined,
        dueTime: formData.dueTime,
        quizTitle: formData.quizTitle,
        quizPassMark: formData.quizPassMark,
        quizQuestionType: formData.quizQuestionType,
        quizAttempts: formData.quizAttempts,
        quizDuration: formData.quizDuration,
        quizDifficulty: formData.quizDifficulty,
        documentId: selectedDocId,
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

        // Reset all wizard state so the next course creation starts fresh
        setCurrentStep(1);
        setFormData(INITIAL_FORM_DATA);
        setGeneratedContent(null);
        setDocuments([]);
        setPublishError(null);
        setIsGenerating(false);
        setIsAnalyzing(false);
        setAnalysisProgress(0);
        setUploadError(null);
        setIsScanningPhi(false);
        setShowPhiError(false);
        setPhiReason(undefined);
        analyzedDocId.current = null;
        setPendingJobId(null);
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
      } else {
        setPublishError('Failed to create course. Please try again.');
      }
    } catch (error) {
      logger.error({ msg: 'Error submitting course:', err: error });
      setPublishError('An unexpected error occurred. Please try again.');
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
        setPublishError(result.error);
        return;
      }
      const publishedId = reviewGate.courseId;
      setReviewGate(null);
      setCreatedCourseId(publishedId);
    } catch (error) {
      logger.error({ msg: 'Error publishing course with warnings:', err: error });
      setPublishError('An unexpected error occurred. Please try again.');
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
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      router.back();
    }
  };

  const handleRetryUpload = () => {
    setShowPhiError(false);
    setPhiReason(undefined);
    setDocuments([]);
  };

  const handleUpload = async (files: File[]) => {
    setUploadError(null);
    const file = files[0];
    if (!file) return;

    setIsAnalyzing(true);
    setAnalysisProgress(10);

    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    uploadFormData.append('rejectOnPHI', 'true');

    try {
      setAnalysisProgress(30);
      const uploadResult = await uploadDocument(null, uploadFormData);

      if (uploadResult.phiDetected) {
        setPhiReason('PHI Detected in document.');
        setShowPhiError(true);
        setIsAnalyzing(false);
        return;
      }

      if (uploadResult.error) {
        throw new Error(uploadResult.error);
      }

      const updatedDocs = await getDocuments();
      setDocuments(
        updatedDocs.map((d) => ({
          id: d.id,
          name: d.filename,
          type: d.filename.endsWith('.pdf') ? 'pdf' : 'docx',
          status: 'analyzed',
          selected: d.filename === file.name,
        })),
      );
      setAnalysisProgress(60);

      const matchedDoc = updatedDocs.find((d) => d.filename === file.name);
      if (matchedDoc) {
        analyzedDocId.current = matchedDoc.id;
      }

      const { analyzeDocument } = await import('@/app/actions/course-ai');
      const analysisFormData = new FormData();
      analysisFormData.append('file', file);

      const result = await analyzeDocument(analysisFormData);
      setAnalysisProgress(100);

      if (result.error) {
        logger.error({ msg: '[course] Document analysis failed', reason: result.error });
        setUploadError(result.error);
      } else {
        setFormData((prev) => ({
          ...prev,
          title: result.title,
          description: result.description,
          objectives: result.objectives,
          duration: result.duration,
          quizTitle: result.quizTitle,
        }));
      }
    } catch (err: unknown) {
      logger.error({ msg: 'Upload/Analysis Failed:', err: err });
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisProgress(0);
      }, 500);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1Category
            selectedCategoryId={formData.categoryId}
            onSelect={(id) => setFormData({ ...formData, categoryId: id })}
          />
        );
      case 2:
        return (
          <Step2Documents
            documents={documents}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDeleteWizardDoc}
            onUpload={handleUpload}
            isAnalyzing={isAnalyzing}
            progress={analysisProgress}
            error={uploadError}
            isScanningPhi={isScanningPhi}
          />
        );
      case 3:
        return (
          <Step3Details
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      case 4:
        return (
          <Step4Quiz
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      case 5:
        return (
          <Step5Review
            data={formData}
            documents={documents}
            initialContent={generatedContent}
            onComplete={handleGenerationComplete}
            pendingJobId={pendingJobId}
          />
        );
      case 6:
        return (
          <Step6QuizReview
            data={formData}
            quiz={generatedContent?.quiz}
            rawContext={generatedContent?.rawArticleMarkdown}
            onQuizUpdate={(newQuiz) =>
              setGeneratedContent((prev) => (prev ? { ...prev, quiz: newQuiz } : null))
            }
          />
        );
      case 7:
        return (
          <Step7Publish
            data={formData}
            onChange={(field, val) => setFormData((prev) => ({ ...prev, [field]: val }))}
          />
        );
      default:
        return <div>Step {currentStep} Content</div>;
    }
  };

  const isNextDisabled = () => {
    if (currentStep === 1) {
      if (!formData.categoryId) return true;
      return false;
    }
    if (currentStep === 2) {
      if (!documents.some((d) => d.selected)) return true;
      if (isAnalyzing || isScanningPhi) return true;
      return false;
    }
    if (currentStep === 3) {
      if (!formData.title?.trim()) return true;
      if (!formData.description?.trim()) return true;

      if (!formData.notesCount) return true;
      if (!formData.objectives || formData.objectives.length < 3) return true;
      if (formData.objectives.some((obj) => !obj.trim())) return true;
      return false;
    }
    if (currentStep === 4) {
      if (!formData.quizTitle?.trim()) return true;
      if (!formData.quizQuestionCount) return true;

      const passMark = parseInt(formData.quizPassMark?.replace('%', '') || '0');
      if (!formData.quizPassMark || isNaN(passMark) || passMark <= 0) return true;
      return false;
    }
    if (currentStep === 5) {
      if (!generatedContent?.modules || generatedContent.modules.length === 0) return true;
      return false;
    }
    if (currentStep === 6) {
      if (!generatedContent?.quiz || generatedContent.quiz.length === 0) return true;
      return false;
    }
    return false;
  };

  // Figma gives each step its own content column: the single-field intro step sits
  // in a narrower, lower-hanging column than the two-column form steps.
  // Max widths include the 20px gutter so the inner column lands on the Figma
  // measure (880 / 1080 / 1200) at 1440px.
  const contentColumnClass =
    currentStep === 1
      ? 'max-w-[920px] flex-1 justify-between pt-14 pb-[60px] md:pt-[170px] md:pb-[70px]'
      : currentStep === 6 || currentStep === 7
        ? 'max-w-[1240px] pt-10 pb-[60px] md:pt-[90px]'
        : 'max-w-[1120px] pt-10 pb-[60px] md:pt-[90px]';

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
        disabled={isNextDisabled() || isGenerating || isPublishing || isAnalyzing || isScanningPhi}
        loading={isGenerating || isPublishing || isAnalyzing || isScanningPhi}
        className="h-[52px] rounded-[12px] px-8 text-base font-semibold tracking-[0.36px] md:h-[56px] md:px-10 md:text-[18px]"
      >
        {currentStep === totalSteps ? 'Publish Course' : 'Next Step'}
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
            Step {currentStep} of {totalSteps}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              if (currentStep > 1) {
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
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
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
                    setCurrentStep(draftToRestore.step);
                    setGeneratedContent(draftToRestore.generatedContent);
                    if (draftToRestore.selectedDocId) {
                      setDocuments((docs) =>
                        docs.map((d) => ({
                          ...d,
                          selected: d.id === draftToRestore.selectedDocId,
                        })),
                      );
                      analyzedDocId.current = draftToRestore.selectedDocId;
                    }
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

        {currentStep === 5 ? (
          <>
            {renderStep()}
            {!isGenerating && (
              <div className="mx-auto flex w-full max-w-[1400px] shrink-0 flex-col gap-3 px-5 py-6">
                {publishError && (
                  <div className="rounded-md bg-[#fed7d7] px-4 py-2.5 text-center text-sm text-[#e53e3e]">
                    {publishError}
                  </div>
                )}
                {navRow}
              </div>
            )}
          </>
        ) : (
          <div className={`mx-auto flex w-full flex-col gap-14 px-5 ${contentColumnClass}`}>
            {renderStep()}

            {publishError && (
              <div className="rounded-md bg-[#fed7d7] px-4 py-2.5 text-center text-sm text-[#e53e3e]">
                {publishError}
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

        <PhiErrorModal
          isOpen={showPhiError}
          onClose={() => setShowPhiError(false)}
          onRetry={handleRetryUpload}
          reason={phiReason}
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
