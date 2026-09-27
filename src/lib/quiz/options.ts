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
 * step with `options` — the same key space `Question.incorrectOptionExplanations`
 * is stored in. A distractor whose rationale the model omitted is left out of
 * the map entirely rather than mapped to an empty string: the renderer lists
 * whatever keys are present, and a blank one would draw a bare "Option B:" with
 * nothing after it.
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

/**
 * The value a writer should persist into `Question.incorrectOptionExplanations`.
 *
 * `undefined` (→ SQL NULL) whenever there is nothing to say, so no row ever
 * holds `{}`. A stored empty object is indistinguishable from a real map to
 * every reader, and would have them render an explanation block with no rows
 * in it for questions that have no distractor rationale at all.
 */
export function toStoredOptionExplanations(
  incorrectOptions: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> | undefined {
  const stored = sanitizeOptionExplanations(incorrectOptions);
  return stored ?? undefined;
}

/**
 * Narrows the `Json?` column back into the map the readers index by option.
 *
 * Returns null for anything that is not a non-empty object of non-empty
 * strings. The column is untyped at the database, and a legacy or hand-edited
 * row must not be able to put an object where a learner expects a sentence.
 */
export function parseStoredOptionExplanations(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return sanitizeOptionExplanations(value as Record<string, unknown>);
}

/**
 * Drops the rationale for one option, for when that option's TEXT is rewritten.
 *
 * A rationale explains a specific wrong answer, so once the answer it describes
 * is gone the sentence is no longer about anything on screen. Dropping beats
 * keeping: a learner cannot match stale prose to the option in front of them.
 */
export function dropOptionExplanation(
  incorrectOptions: Readonly<Record<string, string>> | null | undefined,
  optionIndex: number,
): Record<string, string> | undefined {
  const source = sanitizeOptionExplanations(incorrectOptions);
  if (!source?.[String(optionIndex)]) return source ?? undefined;

  delete source[String(optionIndex)];
  return Object.keys(source).length > 0 ? source : undefined;
}

/**
 * Re-keys a rationale map when the options it points at are reordered.
 *
 * `originalIndexes[newIndex]` is where that option sat before the move, which
 * is how an index-keyed map survives a shuffle instead of being orphaned by it.
 */
export function remapOptionExplanations(
  incorrectOptions: Readonly<Record<string, string>> | null | undefined,
  originalIndexes: readonly number[],
): Record<string, string> | undefined {
  const source = sanitizeOptionExplanations(incorrectOptions);
  if (!source) return undefined;

  const remapped: Record<string, string> = {};
  originalIndexes.forEach((originalIndex, newIndex) => {
    const rationale = source[String(originalIndex)];
    if (rationale) remapped[String(newIndex)] = rationale;
  });

  return Object.keys(remapped).length > 0 ? remapped : undefined;
}

function sanitizeOptionExplanations(
  value: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> | null {
  if (!value) return null;

  const cleaned: Record<string, string> = {};
  for (const [key, rationale] of Object.entries(value)) {
    if (typeof rationale !== 'string') continue;
    const trimmed = rationale.trim();
    if (trimmed) cleaned[key] = trimmed;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
