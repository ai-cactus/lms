export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  type?: string;
  archetype?: string;
  difficulty?: string;
  explanation?: {
    correctExplanation: string;
    incorrectOptions: Record<string, string>;
  };
  evidence?: {
    moduleSectionId: string;
    moduleSectionHeading: string;
  };
  moduleTitle?: string;
  /** Wizard module this question was generated from, in course order. */
  moduleIndex?: number;
  qualityFlags?: string[];
}

export interface QuizAttemptResult {
  score: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
}
