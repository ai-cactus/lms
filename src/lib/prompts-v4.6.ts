/**
 * THERAPTLY LMS PROMPT PIPELINE — v4.6 (production-ready)
 *
 * Flow:
 * A) Document Text -> articleMeta JSON (FIRST) + Article Markdown (SECOND)
 * B) Article Markdown + articleMeta -> Slides JSON (strict brevity)
 * C) Article Markdown + articleMeta -> Quiz JSON (Khan-style, excerpt-grounded, flat options w/ distractorType)
 * D) Quiz JSON + articleMeta -> Judge JSON (flags ambiguity + grounding + structural issues)
 * E) (Optional) Regen flagged questions only -> Patch JSON (same schema as v4.6-quiz)
 *
 * Usage:
 *   import { buildPromptA_v46, buildPromptB_v46, ... } from '@/lib/prompts-v4.6';
 */

// ─── Prompt A — articleMeta FIRST, then Article Markdown ───────────

const PROMPT_A_TEMPLATE = `
ROLE:
You are a senior instructional designer writing staff training for a regulated organization.

INPUT:
Extracted plain text from a PDF/DOCX policy/procedure document. The text may be messy, duplicated, or incomplete.

GOAL:
Produce TWO artifacts in this exact order:
1) articleMeta (JSON in a markdown \`\`\`json fence)
2) Long-form course article (Markdown)
No other text.

HARD RULES:
- SOURCE REQUIRED: Use ONLY the provided document text. If source text is too short to support a course, do not pad or invent.
- SOURCE FIDELITY: Do not invent policies, dates, roles, thresholds, steps, or definitions.
- MODALITY SAFETY: Preserve must/shall/required vs should/recommended vs may/optional exactly as written. Do NOT strengthen or weaken.
- NO VERBATIM DUMPS: Avoid copying long blocks. Short excerpts (<= 25 words) are allowed ONLY inside articleMeta.snippets.
- NO REVIEWER NOTES IN ARTICLE: Any contradictions/gaps go ONLY in articleMeta.meta.gaps or articleMeta.meta.reviewerNotes.

LENGTH RULE (no padding):
- If DOCUMENT_TEXT is under ~300 words or clearly fragmentary: set articleMeta.meta.status = "needs_sources".
  - Then the Markdown article must be a short note titled "Insufficient Source Content" (<= 120 words).
- Otherwise: write to match source material.
  - Typical: 700–1,600 words. Up to 1,900 only if the document supports it.
  - DO NOT pad, repeat, or invent content to hit a word target.

ARTICLEMETA CONTRACT (generate first; article must follow it exactly):
- Create stable IDs:
  - sectionId: s1..sN
  - objectiveId: LO1..
  - snippetId: sn1..
  - normId: n1..
- Sections:
  - If status="ok": 3–6 sections.
- Each section must have:
  - keyPoints: min 2
  - snippetIds: min 1 referencing snippets
  - normIds: can be empty ONLY if no requirement language exists for that section
- Snippets:
  - snippet.text must be an exact excerpt from DOCUMENT_TEXT and <= 25 words.
  - If you cannot extract a safe exact excerpt, still create the snippet with text "" and add a gap note describing why.
- Norms:
  - short, testable requirements preserving modality
  - ideally backed by a snippetId
- anchorHint:
  - best-effort location ("near heading X", "early/middle/late")

OUTPUT 1: articleMeta JSON SCHEMA:
\`\`\`json
{
  "meta": {
    "promptVersion": "v4.6-article",
    "status": "ok",
    "title": "",
    "sourceLabel": "",
    "sectionCount": 0,
    "objectiveCount": 0,
    "gaps": [],
    "reviewerNotes": []
  },
  "learningObjectives": [
    { "id": "LO1", "text": "", "primarySections": ["s1"] }
  ],
  "sections": [
    {
      "sectionId": "s1",
      "title": "",
      "anchorHint": "",
      "keyPoints": ["", ""],
      "normIds": ["n1"],
      "snippetIds": ["sn1"]
    }
  ],
  "snippets": [
    {
      "snippetId": "sn1",
      "sectionId": "s1",
      "anchorHint": "",
      "text": "Exact excerpt <= 25 words"
    }
  ],
  "norms": [
    {
      "normId": "n1",
      "sectionId": "s1",
      "modality": "must|should|may|prohibited|conditional",
      "statement": "Short requirement statement preserving modality",
      "snippetId": "sn1"
    }
  ]
}
\`\`\`

OUTPUT 2: Markdown article (must be grounded in articleMeta):
- Title must match articleMeta.meta.title
- Section order, headings, and meaning must match articleMeta.sections in order.
- Use articleMeta.keyPoints and norms as the backbone.
- Do NOT quote snippets verbatim in the article; paraphrase in plain language.
- Format:
  # <Course Title>
  ## Overview (90–140 words)
  ## Learning Objectives (5–10 bullets; align to articleMeta.learningObjectives)
  Then for each section in articleMeta.sections:
    ## <Section Title>
    - 2–4 short paragraphs
    - ### Key points (4–7 bullets; expand from articleMeta.keyPoints)
    - ### What to do (ONLY if supported by norms with must/should/prohibited/conditional)
    - ### Common mistakes to avoid (ONLY if supported by norms or explicit cautions)

Now produce the outputs in the required order.

DOCUMENT TEXT:
{{DOCUMENT_TEXT}}

OPTIONAL METADATA JSON:
{{METADATA_JSON}}
`;

// ─── Prompt B — Slides JSON ───────────

const PROMPT_B_TEMPLATE = `
ROLE:
You are a course editor converting a long-form course article into slide format.

INPUTS:
1) Course Article Markdown (authoritative)
2) articleMeta JSON (authoritative contract; promptVersion v4.6-article)
3) desiredSlideCount (integer)

GOAL:
Output ONE artifact ONLY:
- Slides JSON (in a markdown \`\`\`json fence)
No other text.

HARD RULES:
- Use ONLY the article + articleMeta. No external knowledge.
- Do not add new facts or strengthen modality.
- Slides must cite sourceSections (sectionIds from articleMeta.sections).

BREVITY RULES (strict):
- Max 4 bullets per slide.
- Max 15 words per bullet.
- Use fragments, not paragraphs.
- Do NOT copy full paragraphs from the article.
- Titles: aim <= 8 words.

NON-NEGOTIABLE SLIDES (conditional):
- Add 1 slide titled "Non-negotiables — <section title>" ONLY IF that section has at least one norm with modality in: must/prohibited/conditional.
- If a section has none, DO NOT create a Non-negotiables slide for it.

SLIDE RULES:
- Each section should contribute at least 1 slide if possible.
- If desiredSlideCount is too low to include at least one slide per section, prioritize sections with must/prohibited/conditional norms and log the tradeoff in meta.reviewerNotes.

OUTPUT SCHEMA:
\`\`\`json
{
  "meta": {
    "promptVersion": "v4.6-slides",
    "basedOnArticleMetaVersion": "v4.6-article",
    "desiredSlideCount": 0,
    "totalSlides": 0,
    "gaps": [],
    "reviewerNotes": []
  },
  "slides": [
    {
      "slideId": "sl01",
      "title": "",
      "bullets": ["", "", ""],
      "sourceSections": ["s1"]
    }
  ]
}
\`\`\`

desiredSlideCount:
{{DESIRED_SLIDE_COUNT}}

COURSE ARTICLE MARKDOWN:
{{ARTICLE_MARKDOWN}}

articleMeta JSON:
{{ARTICLE_META_JSON}}
`;

// ─── Prompt C — Quiz JSON (Khan-style) ───────────

const PROMPT_C_TEMPLATE = `
ROLE:
You are an assessment designer creating Khan Academy–style questions for regulated training.

INPUTS:
1) Course Article Markdown (authoritative)
2) articleMeta JSON (authoritative contract: sections, norms, snippets; promptVersion v4.6-article)
3) requestedQuestionCount (integer set by admin)
4) quizDifficulty ("easy" | "medium" | "hard")

GOAL:
Output ONE artifact ONLY:
- Quiz JSON (in a markdown \`\`\`json fence)
No other text.

HARD RULES:
- Use ONLY the article + articleMeta. No external knowledge.
- Do NOT invent facts, roles, timelines, thresholds, steps, or definitions.
- Preserve modality exactly.
- BAN THESE STEMS:
  - "According to..."
  - "What did the course say..."
  - "Which of the following is mentioned..."
  - Any question about headings/titles.

Khan-style enforcement:
Every question MUST:
1) include a stimulus excerpt (<= 25 words) copied EXACTLY from articleMeta.snippets[].text
2) include evidence.snippetId and evidence.sectionId
3) set stimulus to equal the snippet.text exactly (no edits)
4) use ONE templateId below and test ONE skill

Allowed templateIds:
T1 (modality-check): Which option matches the requirement level in the excerpt?
T2 (apply-rule): Based on the excerpt, which action best complies?
T3 (identify-error): Which option is the first clear mismatch with the excerpt?
T4 (best-justification): Which option best explains why the correct action follows from the excerpt?
T5 (classification): Based on the excerpt, which label/category best fits the described item? (ONLY if the article defines categories)

Difficulty mapping:
- easy: mostly T1/T2
- medium: mostly T2/T3/T4
- hard: mostly T3/T4 + T1 with subtle modality nuance (still excerpt-grounded)

QUESTION COUNT RULE:
- requestedQuestionCount is the target, but DO NOT force a minimum.
- Generate only as many high-quality questions as the material supports.
- If you output fewer than requestedQuestionCount, explain the shortfall in meta.gaps and meta.coverageNote.
- Never create filler.

DISTRACTOR MECHANICS (must be logged per wrong option):
For each wrong option, it must be wrong in exactly ONE way and you must label it:
D1: Modality swap (must -> should, should -> must, may -> must, prohibited -> allowed)
D2: Adds an unstated prerequisite/step not in the excerpt
D3: Reverses the condition/outcome described
D4: Overgeneralizes scope beyond the excerpt
D5: Wrong order/sequence (ONLY if sequence is described)

OPTION RULES (strict):
- Exactly 4 options per question.
- Exactly 1 option must have isCorrect=true.
- Correct option: distractorType must be null.
- Wrong options: distractorType must be one of "D1","D2","D3","D4","D5".
- Options must be grammatically parallel.
- Ambiguity check: if 2 options are defensible from the excerpt, rewrite until only one is defensible.

EXPLANATION RULES:
- Each option object must include its own explanation:
  - Correct option explanation: 25–55 words, grounded in the excerpt meaning (no new facts).
  - Distractor explanations: 12–30 words and must mention the distractorType logic (e.g., "This swaps must to should (D1)...").

OUTPUT SCHEMA:
\`\`\`json
{
  "meta": {
    "promptVersion": "v4.6-quiz",
    "basedOnArticleMetaVersion": "v4.6-article",
    "requestedQuestionCount": 0,
    "quizDifficulty": "",
    "totalQuestions": 0,
    "coverageNote": "",
    "gaps": [],
    "reviewerNotes": []
  },
  "questions": [
    {
      "id": "q01",
      "sectionId": "s1",
      "templateId": "T2",
      "skill": "apply-rule",
      "difficulty": "easy",
      "stimulus": "Exact excerpt <= 25 words",
      "question": "",
      "evidence": { "snippetId": "sn1", "sectionId": "s1" },
      "options": [
        { "text": "", "isCorrect": true,  "distractorType": null, "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D1", "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D2", "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D4", "explanation": "" }
      ]
    }
  ]
}
\`\`\`

requestedQuestionCount:
{{REQUESTED_QUESTION_COUNT}}

quizDifficulty:
{{QUIZ_DIFFICULTY}}

COURSE ARTICLE MARKDOWN:
{{ARTICLE_MARKDOWN}}

articleMeta JSON:
{{ARTICLE_META_JSON}}
`;

// ─── Prompt D — Judge ───────────

const PROMPT_D_TEMPLATE = `
ROLE:
You are a strict quiz ambiguity and grounding judge for regulated training.

INPUTS:
1) Quiz JSON (authoritative; v4.6-quiz)
2) articleMeta JSON (authoritative: snippets, norms, sections)

GOAL:
Output ONE artifact ONLY:
- ONE valid JSON object in a markdown \`\`\`json fence
No other text.

HARD RULES:
- Use ONLY Quiz JSON + articleMeta JSON. No external knowledge.
- Do not rewrite questions. Flag issues only.

CHECKS (per question):
A) Grounding
- evidence.snippetId exists in articleMeta.snippets
- question.stimulus matches snippet.text exactly
- evidence.sectionId equals snippet.sectionId

B) Options integrity
- exactly 4 options
- exactly 1 option has isCorrect=true
- correct option has distractorType null
- wrong options have distractorType in D1..D5

C) Ambiguity
- Using ONLY the stimulus excerpt, verify only 1 option is defensible.

D) Template consistency
- templateId in T1..T5
- T5 only if classification is supported; otherwise template-mismatch.

SUGGESTED FIX APPROACH:
- "tighten-stimulus"
- "tighten-question"
- "fix-distractor-D1"..."fix-distractor-D5"
- "fix-template"
- "fix-evidence"
- "fix-options-structure"

OUTPUT SCHEMA:
\`\`\`json
{
  "meta": {
    "promptVersion": "v4.6-judge",
    "totalQuestions": 0,
    "ambiguousCount": 0,
    "invalidCount": 0,
    "notes": []
  },
  "ambiguous": [
    {
      "questionId": "q07",
      "why": "",
      "defensibleOptions": [0, 2],
      "suggestedFix": "tighten-question"
    }
  ],
  "invalid": [
    {
      "questionId": "q03",
      "type": "missing-snippet | stimulus-mismatch | section-mismatch | template-mismatch | options-structure",
      "why": "",
      "suggestedFix": "fix-options-structure"
    }
  ]
}
\`\`\`

QUIZ JSON:
{{QUIZ_JSON}}

articleMeta JSON:
{{ARTICLE_META_JSON}}
`;

// ─── Prompt E — Regenerate flagged questions ───────────

const PROMPT_E_TEMPLATE = `
ROLE:
You are an assessment designer repairing ONLY the flagged quiz questions for regulated training.

INPUTS:
1) Course Article Markdown (authoritative)
2) articleMeta JSON (authoritative)
3) Original Quiz JSON (authoritative)
4) Judge JSON (authoritative list of ambiguous/invalid questionIds)
5) quizDifficulty ("easy"|"medium"|"hard")

GOAL:
Output ONE artifact ONLY:
- ONE valid JSON object in a markdown \`\`\`json fence
No other text.

RULES:
- Only regenerate questions whose ids appear in Judge JSON ambiguous[] or invalid[].
- Preserve question.id values exactly.
- Use the same schema as v4.6-quiz for each regenerated question.
- Keep stimulus excerpt exactly equal to the snippet text referenced by evidence.snippetId.
- Fix according to judge.suggestedFix where possible.
- Exactly 4 options, exactly 1 correct, wrong options must have D1..D5 with explanations.

OUTPUT SCHEMA:
\`\`\`json
{
  "meta": {
    "promptVersion": "v4.6-regenerate",
    "regeneratedCount": 0,
    "reviewerNotes": []
  },
  "questions": [
    {
      "id": "q07",
      "sectionId": "s2",
      "templateId": "T3",
      "skill": "identify-error",
      "difficulty": "hard",
      "stimulus": "Exact excerpt <= 25 words",
      "question": "",
      "evidence": { "snippetId": "sn9", "sectionId": "s2" },
      "options": [
        { "text": "", "isCorrect": true,  "distractorType": null, "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D1", "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D2", "explanation": "" },
        { "text": "", "isCorrect": false, "distractorType": "D4", "explanation": "" }
      ]
    }
  ]
}
\`\`\`

quizDifficulty:
{{QUIZ_DIFFICULTY}}

COURSE ARTICLE MARKDOWN:
{{ARTICLE_MARKDOWN}}

articleMeta JSON:
{{ARTICLE_META_JSON}}

ORIGINAL QUIZ JSON:
{{QUIZ_JSON}}

JUDGE JSON:
{{JUDGE_JSON}}
`;

// ─── Builder Functions ───────────────────────────

export function buildPromptA_v46(documentText: string, metadataJson?: string): string {
  return PROMPT_A_TEMPLATE.replace('{{DOCUMENT_TEXT}}', documentText).replace(
    '{{METADATA_JSON}}',
    metadataJson || 'None',
  );
}

export function buildPromptB_v46(
  articleMarkdown: string,
  articleMetaJson: string,
  desiredSlideCount: number,
): string {
  return PROMPT_B_TEMPLATE.replace('{{ARTICLE_MARKDOWN}}', articleMarkdown)
    .replace('{{ARTICLE_META_JSON}}', articleMetaJson)
    .replace('{{DESIRED_SLIDE_COUNT}}', String(desiredSlideCount));
}

export function buildPromptC_v46(
  articleMarkdown: string,
  articleMetaJson: string,
  requestedQuestionCount: number,
  quizDifficulty: string,
): string {
  return PROMPT_C_TEMPLATE.replace('{{ARTICLE_MARKDOWN}}', articleMarkdown)
    .replace('{{ARTICLE_META_JSON}}', articleMetaJson)
    .replace('{{REQUESTED_QUESTION_COUNT}}', String(requestedQuestionCount))
    .replace('{{QUIZ_DIFFICULTY}}', quizDifficulty);
}

export function buildPromptD_v46(quizJson: string, articleMetaJson: string): string {
  return PROMPT_D_TEMPLATE.replace('{{QUIZ_JSON}}', quizJson).replace(
    '{{ARTICLE_META_JSON}}',
    articleMetaJson,
  );
}

export function buildPromptE_v46(
  articleMarkdown: string,
  articleMetaJson: string,
  quizJson: string,
  judgeJson: string,
  quizDifficulty: string,
): string {
  return PROMPT_E_TEMPLATE.replace('{{ARTICLE_MARKDOWN}}', articleMarkdown)
    .replace('{{ARTICLE_META_JSON}}', articleMetaJson)
    .replace('{{QUIZ_JSON}}', quizJson)
    .replace('{{JUDGE_JSON}}', judgeJson)
    .replace('{{QUIZ_DIFFICULTY}}', quizDifficulty);
}
