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
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import PhiErrorModal from './PhiErrorModal';
import { createFullCourse } from '@/app/actions/course';
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

  // Documents State
  const [documents, setDocuments] = useState<CourseDocument[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Generation/Publishing State
  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // PHI Scanning State
  const [isScanningPhi, setIsScanningPhi] = useState(false);
  const [showPhiError, setShowPhiError] = useState(false);
  const [phiReason, setPhiReason] = useState<string | undefined>(undefined);
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);

  // Exit confirmation state
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Publish confirmation state
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Draft resume state
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
      // Cleanup legacy draft
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

  // Autosave Draft
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
            logger.error({ msg: 'Analysis failed:', err: result.error });
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
      // Validate before submit
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
        setCreatedCourseId(result.courseId);
        sessionStorage.removeItem(DRAFT_KEY);
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
        logger.error({ msg: 'Analysis Error:', err: result.error });
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

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-body">
      <header className="relative flex h-20 w-full shrink-0 border-b border-border bg-background max-md:px-4">
        <div className="relative flex w-[250px] items-center justify-center border-r border-border max-md:mr-4 max-md:w-auto max-md:border-r-0">
          <Logo variant="blue" size="md" />
        </div>
        <div className="flex flex-1 items-center justify-between px-10 max-md:px-0">
          <span className="text-base font-medium text-[#2d3748] max-md:mr-auto max-md:text-sm">
            Step {currentStep} of {totalSteps}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (currentStep > 1) {
                setShowExitConfirm(true);
              } else {
                router.push('/dashboard/courses');
              }
            }}
          >
            Exit
          </Button>
        </div>
        <div
          className="absolute bottom-0 left-0 z-10 h-1 bg-primary transition-[width] duration-300 ease-[ease]"
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
        />
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pt-10 pb-1.5 max-md:px-4 max-md:pt-6">
        {showResumeBanner && (
          <div className="bg-[#EBF4FF] border border-[#BEE3F8] rounded-lg p-4 mb-6 flex justify-between items-center">
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

        {renderStep()}

        {(!isGenerating || currentStep !== 5) && (
          <div
            className={`flex w-full shrink-0 justify-between px-5 z-20 mt-4 mb-4 transition-[max-width] duration-300 ease-[ease] max-md:mt-8 max-md:mb-8 max-md:px-0 ${
              currentStep === 5 ? 'max-w-[1400px]' : 'max-w-[800px]'
            }`}
          >
            {publishError && (
              <div className="mb-3 rounded-md bg-[#fed7d7] px-4 py-2.5 text-center text-sm text-[#e53e3e]">
                {publishError}
              </div>
            )}
            <div className="flex w-full justify-between">
              <Button variant="secondary" onClick={handleBack} disabled={isPublishing}>
                Back
              </Button>
              <Button
                variant="default"
                onClick={handleNext}
                disabled={
                  isNextDisabled() || isGenerating || isPublishing || isAnalyzing || isScanningPhi
                }
                loading={isGenerating || isPublishing || isAnalyzing || isScanningPhi}
              >
                {currentStep === totalSteps ? 'Publish Course' : 'Next Step'}
              </Button>
            </div>
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

        <ConfirmPublishModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handlePublish}
          courseTitle={formData.title}
          isPublishing={isPublishing}
        />

        {currentStep === 2 && (
          <div className="flex flex-col items-center text-center py-6 mt-4 bg-[#FAFCFE] rounded-xl border border-dashed border-[#E2E8F0] w-full max-w-[800px]">
            {/* Icon Layer from PhiErrorModal */}
            <div className="relative w-[120px] h-[120px] mb-6">
              {/* Document Icon */}
              <svg
                width="100"
                height="100"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="20" y="15" width="60" height="70" rx="4" fill="#F1F5F9" />
                <rect
                  x="20"
                  y="15"
                  width="60"
                  height="70"
                  rx="4"
                  stroke="#E2E8F0"
                  strokeWidth="2"
                />
                <line
                  x1="30"
                  y1="30"
                  x2="70"
                  y2="30"
                  stroke="#CBD5E0"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="30"
                  y1="40"
                  x2="70"
                  y2="40"
                  stroke="#CBD5E0"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="30"
                  y1="50"
                  x2="70"
                  y2="50"
                  stroke="#CBD5E0"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              {/* Magnifying Glass with Badge */}
              <div className="absolute bottom-0 left-[-10px] [filter:drop-shadow(0px_10px_15px_rgba(0,0,0,0.1))]">
                <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
                  <circle cx="25" cy="25" r="20" fill="white" stroke="#4C6EF5" strokeWidth="4" />
                  <path d="M40 40L55 55" stroke="#4C6EF5" strokeWidth="6" strokeLinecap="round" />
                  <path d="M18 25H32" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                  <path d="M18 18H28" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                  <path d="M18 32H24" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <h2 className="text-xl font-bold text-[#1A202C] mb-3">We care about your privacy!</h2>
            <p className="text-[15px] text-[#4A5568] max-w-[500px] leading-relaxed mb-0">
              Ensure that any document you upload does NOT contain personal health information.
            </p>
          </div>
        )}

        <PhiErrorModal
          isOpen={showPhiError}
          onClose={() => setShowPhiError(false)}
          onRetry={handleRetryUpload}
          reason={phiReason}
        />

        {showExitConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
            <div className="bg-white w-[90%] max-w-[420px] rounded-2xl p-6 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)]">
              <h2 className="text-lg font-semibold text-[#1A202C] mb-3">Exit course creation?</h2>
              <p className="text-sm text-[#4A5568] mb-6 leading-relaxed">
                You have unsaved progress. If you exit now, your work will be lost.
              </p>
              <div className="flex justify-end gap-3">
                <Button variant="outline" size="sm" onClick={() => setShowExitConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    sessionStorage.removeItem(DRAFT_KEY);
                    router.push('/dashboard/courses');
                  }}
                >
                  Exit
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
