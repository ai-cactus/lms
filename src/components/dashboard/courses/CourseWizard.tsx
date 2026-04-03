'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './CourseWizard.module.css';
import Step2Documents from './steps/Step2Documents';
import Step3Details from './steps/Step3Details';
import Step4Quiz from './steps/Step4Quiz';
import Step5Review from './steps/Step5Review';
import Step6QuizReview from './steps/Step6QuizReview';
import Step7Publish from './steps/Step7Publish';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import PhiErrorModal from './PhiErrorModal';
import { createFullCourse } from '@/app/actions/course';
import { analyzeStoredDocument } from '@/app/actions/course-ai';
import { getDocuments, uploadDocument, deleteDocument } from '@/app/actions/documents';
import { CourseWizardData, GeneratedCourse, CourseDocument } from '@/types/course';

const INITIAL_FORM_DATA: CourseWizardData = {
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

export default function CourseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDocId = searchParams.get('documentId');
  const hasAutoAnalyzed = useRef(false);

  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const totalSteps = 6;
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

  // Exit confirmation state
  const [showExitConfirm, setShowExitConfirm] = useState(false);

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

        if (initialDocId && !hasAutoAnalyzed.current) {
          hasAutoAnalyzed.current = true;
          handleAutoAnalyze(initialDocId);
        }
      } catch (e) {
        console.error('Failed to load documents', e);
      }
    };
    loadDocs();
  }, [initialDocId]);

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
      console.error('Auto-analysis failed', err);
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
      console.error('Failed to delete document from wizard:', err);
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
      if (!selectedDoc) return;

      setIsAnalyzing(true);
      setAnalysisProgress(30);

      try {
        const result = await analyzeStoredDocument(selectedDoc.id);
        setAnalysisProgress(100);

        if (result.error) {
          console.error('Analysis failed:', result.error);
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
      } catch (err) {
        console.error('Error analyzing stored doc:', err);
      } finally {
        setIsAnalyzing(false);
        setAnalysisProgress(0);
        setCurrentStep(currentStep + 1);
      }
      return;
    }

    if (currentStep < totalSteps) {
      if (currentStep === 4 && !generatedContent) {
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

      setIsPublishing(true);
      setPublishError(null);

      const selectedDocId = documents.find((d) => d.selected)?.id;

      try {
        const result = await createFullCourse({
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
          hasAutoAnalyzed.current = false;
          router.push('/dashboard/training');
        } else {
          setPublishError('Failed to create course. Please try again.');
        }
      } catch (error) {
        console.error('Error submitting course:', error);
        setPublishError('An unexpected error occurred. Please try again.');
      } finally {
        setIsPublishing(false);
      }
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

      const { analyzeDocument } = await import('@/app/actions/course-ai');
      const analysisFormData = new FormData();
      analysisFormData.append('file', file);

      const result = await analyzeDocument(analysisFormData);
      setAnalysisProgress(100);

      if (result.error) {
        console.error('Analysis Error:', result.error);
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
      console.error('Upload/Analysis Failed:', err);
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
      case 2:
        return (
          <Step3Details
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      case 3:
        return (
          <Step4Quiz
            data={formData}
            onChange={(field, val) => setFormData({ ...formData, [field]: val })}
          />
        );
      case 4:
        return (
          <Step5Review
            data={formData}
            documents={documents}
            initialContent={generatedContent}
            onComplete={handleGenerationComplete}
          />
        );
      case 5:
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
      case 6:
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
      if (!documents.some((d) => d.selected)) return true;
      if (isAnalyzing || isScanningPhi) return true;
      return false;
    }
    if (currentStep === 2) {
      if (!formData.title?.trim()) return true;
      if (!formData.description?.trim()) return true;

      if (!formData.notesCount) return true;
      if (!formData.objectives || formData.objectives.length < 3) return true;
      if (formData.objectives.some((obj) => !obj.trim())) return true;
      return false;
    }
    if (currentStep === 3) {
      if (!formData.quizTitle?.trim()) return true;
      if (!formData.quizQuestionCount) return true;

      const passMark = parseInt(formData.quizPassMark?.replace('%', '') || '0');
      if (!formData.quizPassMark || isNaN(passMark) || passMark <= 0) return true;
      return false;
    }
    if (currentStep === 4) {
      if (!generatedContent?.modules || generatedContent.modules.length === 0) return true;
      return false;
    }
    if (currentStep === 5) {
      if (!generatedContent?.quiz || generatedContent.quiz.length === 0) return true;
      return false;
    }
    return false;
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoSection}>
          <Logo variant="blue" size="md" />
        </div>
        <div className={styles.headerContent}>
          <span className={styles.stepText}>
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
          className={styles.progressBar}
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
        />
      </header>

      <main className={styles.content}>
        {renderStep()}

        {(!isGenerating || currentStep !== 4) && (
          <div className={`${styles.footer} ${currentStep === 4 ? styles.footerWide : ''}`}>
            {publishError && <div className={styles.errorMessage}>{publishError}</div>}
            <div className={styles.footerButtons}>
              <Button variant="secondary" size="md" onClick={handleBack} disabled={isPublishing}>
                Back
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleNext}
                disabled={isNextDisabled() || isAnalyzing}
                loading={isPublishing}
              >
                {currentStep === totalSteps ? 'Publish' : 'Next'}
              </Button>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className={styles.privacyNotice}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              We care about your privacy! Ensure that any document you upload does NOT contain
              personal health information.
            </span>
          </div>
        )}

        <PhiErrorModal
          isOpen={showPhiError}
          onClose={() => setShowPhiError(false)}
          onRetry={handleRetryUpload}
          reason={phiReason}
        />

        {showExitConfirm && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                background: 'white',
                width: '90%',
                maxWidth: '420px',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
            >
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#1A202C',
                  marginBottom: '12px',
                }}
              >
                Exit course creation?
              </h2>
              <p
                style={{
                  fontSize: '14px',
                  color: '#4A5568',
                  marginBottom: '24px',
                  lineHeight: 1.5,
                }}
              >
                You have unsaved progress. If you exit now, your work will be lost.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <Button variant="outline" size="sm" onClick={() => setShowExitConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => router.push('/dashboard/courses')}
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
