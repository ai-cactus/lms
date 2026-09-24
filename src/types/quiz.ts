export interface QuizExplanation {
  correctExplanation: string;
  /** Rationale per WRONG option, keyed by that option's index in `options`. */
  incorrectOptions: Record<string, string>;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  type?: string;
  archetype?: string;
  difficulty?: string;
  explanation?: QuizExplanation;
  evidence?: {
    moduleSectionId: string;
    moduleSectionHeading: string;
  };
  moduleTitle?: string;
  /** Wizard module this question was generated from, in course order. */
  moduleIndex?: number;
  qualityFlags?: string[];
}
