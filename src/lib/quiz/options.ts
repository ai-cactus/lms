import type { QuizExplanation } from '@/types/quiz';

/**
 * One answer option exactly as every AI quiz prompt in the app asks for it —
 * the v4.6 pipeline's Stage C and the wizard's single-question / regenerate
 * actions alike (see `QuizOptionV46Schema` in prompt-schemas-v4.6.ts).
 */
export interface GeneratedQuizOption {
  text: string;
  isCorrect: boolean;
  distractorType?: string | null;
  explanation?: string;
}

export interface AdaptedQuizOptions {
  options: string[];
  answer: number;
  explanation: QuizExplanation;
}

/** Fisher-Yates shuffle. Returns a NEW array; the input is not mutated. */
export function shuffleArray<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Flattens the per-option shape the model returns into the `{ options: string[],
 * answer: number, explanation }` shape `QuizQuestion` carries, shuffling so the
 * correct answer is not always the option the model happened to write first.
 *
 * Shared by the bulk v4.6 path and the wizard's single-question / regenerate
 * actions so both produce the same question — a rationale for the correct
 * answer AND for each distractor (founder ruling Q-13).
 *
 * `incorrectOptions` is keyed by the POST-shuffle option index, so it stays in
 * step with `options`. A distractor whose rationale the model omitted is left
 * out of the map entirely rather than mapped to an empty string: the renderer
 * lists whatever keys are present, and a blank one would draw a bare
 * "Option B:" with nothing after it.
 */
export function adaptQuizOptions(options: readonly GeneratedQuizOption[]): AdaptedQuizOptions {
  const shuffled = shuffleArray(options);
  const answer = shuffled.findIndex((option) => option.isCorrect);

  const incorrectOptions: Record<string, string> = {};
  shuffled.forEach((option, index) => {
    if (option.isCorrect) return;
    const rationale = option.explanation?.trim();
    if (rationale) incorrectOptions[String(index)] = rationale;
  });

  return {
    options: shuffled.map((option) => option.text),
    answer: answer >= 0 ? answer : 0,
    explanation: {
      correctExplanation: shuffled[answer]?.explanation?.trim() || '',
      incorrectOptions,
    },
  };
}
