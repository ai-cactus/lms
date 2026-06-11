import { ParsedQuiz, ParsedQuestion, QuizImportError } from './types';

/** Minimal RFC-4180-ish line splitter that respects double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function resolveCorrect(raw: string, options: string[], rowNo: number): string {
  const v = raw.trim();
  const letter = v.toUpperCase();
  if (/^[A-D]$/.test(letter)) {
    const idx = letter.charCodeAt(0) - 65;
    if (idx < options.length) return options[idx];
    throw new QuizImportError(`Row ${rowNo}: correct_answer "${v}" has no matching option`, [
      rowNo,
    ]);
  }
  const match = options.find((o) => o === v);
  if (!match)
    throw new QuizImportError(`Row ${rowNo}: correct_answer "${v}" matches no option`, [rowNo]);
  return match;
}

export function parseQuizCsv(text: string): ParsedQuiz {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2)
    throw new QuizImportError('CSV must have a header row and at least one question');
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const qi = col('question');
  const optCols = ['option_a', 'option_b', 'option_c', 'option_d'].map(col).filter((i) => i >= 0);
  const ci = col('correct_answer');
  const ei = col('explanation');
  if (qi < 0 || ci < 0 || optCols.length < 2) {
    throw new QuizImportError(
      'CSV header must include question, option_a, option_b, correct_answer',
    );
  }

  const questions: ParsedQuestion[] = lines.slice(1).map((line, i) => {
    const rowNo = i + 2; // 1-based incl. header
    const cells = splitCsvLine(line);
    const text = (cells[qi] ?? '').trim();
    if (!text) throw new QuizImportError(`Row ${rowNo}: empty question text`, [rowNo]);
    const options = optCols.map((c) => (cells[c] ?? '').trim()).filter(Boolean);
    if (options.length < 2)
      throw new QuizImportError(`Row ${rowNo}: needs at least 2 options`, [rowNo]);
    const correctAnswer = resolveCorrect(cells[ci] ?? '', options, rowNo);
    const explanationRaw = ei >= 0 ? (cells[ei] ?? '').trim() : '';
    return { text, options, correctAnswer, explanation: explanationRaw || undefined, order: i };
  });

  return { questions };
}

export function parseQuizJson(text: string): ParsedQuiz {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new QuizImportError('Invalid JSON');
  }
  const root = data as { passingScore?: number; allowedAttempts?: number; questions?: unknown[] };
  if (!Array.isArray(root.questions) || root.questions.length === 0) {
    throw new QuizImportError('JSON must contain a non-empty "questions" array');
  }
  const questions: ParsedQuestion[] = root.questions.map((raw, i) => {
    const q = raw as {
      text?: string;
      options?: string[];
      correctAnswer?: string | number;
      explanation?: string;
    };
    const text = (q.text ?? '').trim();
    const options = (q.options ?? []).map((o) => String(o).trim()).filter(Boolean);
    if (!text) throw new QuizImportError(`Question ${i + 1}: empty text`, [i + 1]);
    if (options.length < 2)
      throw new QuizImportError(`Question ${i + 1}: needs at least 2 options`, [i + 1]);
    if (options.length > 4)
      throw new QuizImportError(`Question ${i + 1}: max 4 options allowed`, [i + 1]);
    let correctAnswer: string;
    if (typeof q.correctAnswer === 'number') {
      if (q.correctAnswer < 0 || q.correctAnswer >= options.length) {
        throw new QuizImportError(`Question ${i + 1}: correctAnswer index out of range`, [i + 1]);
      }
      correctAnswer = options[q.correctAnswer];
    } else {
      const v = String(q.correctAnswer ?? '').trim();
      const letter = v.toUpperCase();
      if (/^[A-D]$/.test(letter) && letter.charCodeAt(0) - 65 < options.length) {
        correctAnswer = options[letter.charCodeAt(0) - 65];
      } else {
        const match = options.find((o) => o === v);
        if (!match)
          throw new QuizImportError(`Question ${i + 1}: correctAnswer matches no option`, [i + 1]);
        correctAnswer = match;
      }
    }
    return {
      text,
      options,
      correctAnswer,
      explanation: q.explanation?.trim() || undefined,
      order: i,
    };
  });
  return {
    passingScore: typeof root.passingScore === 'number' ? root.passingScore : undefined,
    allowedAttempts: typeof root.allowedAttempts === 'number' ? root.allowedAttempts : undefined,
    questions,
  };
}

export function parseQuizFile(filename: string, text: string): ParsedQuiz {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'json') return parseQuizJson(text);
  if (ext === 'csv') return parseQuizCsv(text);
  throw new QuizImportError(`Unsupported quiz file type ".${ext}". Use .csv or .json`);
}
