export type VideoProviderKey = 'self' | 'mux' | 'cloudflare' | 'embed';

export interface VideoSource {
  resolvePlaybackUrl(
    lesson: { videoProvider: string | null; videoStorageUri: string | null },
    expirySeconds?: number,
  ): Promise<string>;
}

export interface ParsedQuestion {
  text: string;
  options: string[]; // 2–4 option texts
  correctAnswer: string; // normalized to the exact option TEXT (grading parity)
  explanation?: string;
  order: number; // 0-based
}

export interface ParsedQuiz {
  passingScore?: number; // optional overrides from the file
  allowedAttempts?: number;
  questions: ParsedQuestion[];
}

export class QuizImportError extends Error {
  constructor(
    message: string,
    readonly rows?: number[],
  ) {
    super(message);
    this.name = 'QuizImportError';
  }
}
