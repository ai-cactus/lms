'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './CourseWizard.module.css';
import Step1Category from './steps/Step1Category';
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
import { getDocuments, uploadDocument } from '@/app/actions/documents';
import { CourseWizardData, GeneratedCourse, CourseDocument } from '@/types/course';

export default function CourseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDocId = searchParams.get('documentId');
  const hasAutoAnalyzed = useRef(false);

  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const totalSteps = 7;
  const [formData, setFormData] = useState<CourseWizardData>({
    category: '',
    title: 'HIPAA Privacy and Security Training',
    description:
      'This course provides essential training on the HIPAA Privacy and Security Rules, helping healthcare professionals understand how to safeguard Protected Health Information (PHI).',
    difficulty: 'moderate',
    duration: '',
    notesCount: '10',
    objectives: [
      'To train staff on HIPAA compliance in behavioral health.',
      'Learn how to handle PHI securely',
      'Understand HIPAA privacy rules',
    ],
    quizTitle: 'HIPAA Privacy and Security Quiz',
    quizQuestionCount: '15',
    quizDifficulty: 'medium',
    quizQuestionType: 'multiple_choice',
    quizDuration: '',
    quizPassMark: '80%',
    quizAttempts: '2',
    assignments: [],
    dueDate: '',
    dueTime: '',
  });

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
          title: result.title || prev.title,
          description: result.description || prev.description,
          objectives: result.objectives?.length ? result.objectives : prev.objectives,
          duration: result.duration || prev.duration,
          quizTitle: result.quizTitle || prev.quizTitle,
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

  const handleGenerationComplete = (content: GeneratedCourse) => {
    setGeneratedContent(content);
    setIsGenerating(false);
    // Flow AI-computed duration back into formData
    if (content.duration) {
      setFormData((prev) => ({ ...prev, duration: content.duration }));
    }
  };

  const handleNext = async () => {
    if (isNextDisabled()) return;

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
            title: result.title || prev.title,
            description: result.description || prev.description,
            objectives: result.objectives?.length ? result.objectives : prev.objectives,
            duration: result.duration || prev.duration,
            quizTitle: result.quizTitle || prev.quizTitle,
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
          category: formData.category,
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
      setDocuments((prevDocs) =>
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
          title: result.title || prev.title,
          description: result.description || prev.description,
          objectives: result.objectives?.length ? result.objectives : prev.objectives,
          duration: result.duration || prev.duration,
          quizTitle: result.quizTitle || prev.quizTitle,
        }));
      }
    } catch (err: any) {
      console.error('Upload/Analysis Failed:', err);
      setUploadError(err.message || 'Upload failed. Please try again.');
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
            value={formData.category}
            onChange={(val) => setFormData({ ...formData, category: val })}
          />
        );
      case 2:
        return (
          <Step2Documents
            documents={documents}
            onToggleSelect={handleToggleSelect}
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
    if (currentStep === 1 && !formData.category) return true;
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
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoSection}>
          <Logo variant="blue" size="md" />
        </div>
        <div className={styles.headerContent}>
          <span className={styles.stepText}>
            Step {currentStep} of {totalSteps}
          </span>
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/courses')}>
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

        {(!isGenerating || currentStep !== 5) && (
          <div className={`${styles.footer} ${currentStep === 5 ? styles.footerWide : ''}`}>
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

        {currentStep === 2 && (
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
      </main>
    </div>
  );
}
