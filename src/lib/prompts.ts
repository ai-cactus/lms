/**
 * THERAPTLY LMS PROMPT PIPELINE — v3.1
 *
 * Exported prompt templates for the two-stage AI generation pipeline:
 * A) Prompt A → Structured Course JSON (no HTML, no Markdown)
 * B) Prompt B → Quiz JSON with embedded explanations
 *
 * Usage:
 *   import { buildPromptA, buildPromptB } from '@/lib/prompts';
 *   const promptA = buildPromptA({ sourceTexts, metadata });
 *   const promptB = buildPromptB({ courseJson, questionCount, difficulty });
 */

// ─── Metadata builder ────────────────────────────

interface DocumentMeta {
  docId: string;
  label: string;
  hint?: string;
}

interface PromptAInput {
  sourceTexts: string;
  documents: DocumentMeta[];
  title?: string;
  category?: string;
  requestedSlideCount?: number;
}

interface PromptBInput {
  courseJson: string;
  requestedQuestionCount: number;
  quizDifficulty: 'easy' | 'medium' | 'hard';
}

function buildMetadataSection(documents: DocumentMeta[]): string {
  if (documents.length === 0) return 'METADATA:\nNo documents provided.';
  const entries = documents
    .map(
      (d, i) =>
        `  - docId: "${d.docId}", label: "${d.label}"${d.hint ? `, hint: "${d.hint}"` : ''}`,
    )
    .join('\n');
  return `METADATA:\nSource Documents:\n${entries}`;
}

// ─── Prompt A — Structured Course JSON ───────────

export function buildPromptA(input: PromptAInput): string {
  const metadataSection = buildMetadataSection(input.documents);
  const contextForGeneration = input.sourceTexts;

  return `
ROLE:
You are a senior instructional designer and compliance-minded writer creating staff training for a regulated organization.

INPUT:
Multiple source documents (summaries or full text). These may overlap, conflict, or be incomplete.
${metadataSection}

GOAL:
Output ONE artifact ONLY:
- ONE valid JSON object in a markdown \`\`\`json fence
No other text.

HARD RULES (non-negotiable):
- SOURCE REQUIRED: Use ONLY the provided sources. If sources are empty or missing, output a valid JSON object with meta.status = "needs_sources" and explain in meta.gaps. Do NOT generate training from general knowledge.
- SOURCE FIDELITY: Do not invent policies, dates, rules, definitions, categories, thresholds, timelines, roles, or procedures.
- MODALITY SAFETY: Preserve obligation language exactly as in sources (must/shall/required vs should/recommended vs may/optional). Do NOT strengthen or weaken.
- NO VERBATIM DUMPS: Do not copy large blocks verbatim. Short phrases are allowed when essential, but keep rare.
- STRUCTURED OUTPUT: Do not output HTML or Markdown. Use plain text fields and arrays.

LENGTH + STRUCTURE (anti-truncation):
- Modules: 3–5 modules.
- Each module: 2–4 sections.
- Each section: 2–4 short paragraphs max.
- Keep text staff-friendly and practical.
- SLIDES: Generate exactly ${input.requestedSlideCount || 10} slides total, distributed evenly across all modules. Each slide MUST have a slideTitle and 3–5 concise bullets summarizing key points from the corresponding module sections. Do NOT leave slides arrays empty.

TRACEABILITY (lightweight, engineer-friendly):
- Every module.section MUST include sourceAnchors with docId and a hint.
- If the sources provide page/section hints, use them. If not, use a best-effort hint like "near heading <X>" or "early/middle/late in document".
- If you cannot identify any hint at all, still include a sourceAnchors entry with the docId and hint "" and add a reviewerNote type "needs-review".

ROLES:
- Do NOT invent roles.
- If roles appear in sources (e.g., supervisor, clinician, compliance officer), you may use only those exact role terms in the course text.

OUTPUT REQUIREMENTS:
- Required keys must exist. Extra keys are allowed ONLY if they do not remove/rename required keys.

OUTPUT SCHEMA (required keys and structure):
\`\`\`json
{
  "meta": {
    "promptVersion": "v3.1",
    "status": "ok",
    "titleUsed": "",
    "category": "",
    "courseDifficulty": "",
    "estimatedDurationMinutes": 0,
    "moduleCount": 0,
    "objectiveCount": 0,
    "sourceDocIndex": [
      { "docId": "doc-1", "label": "", "hint": "" }
    ],
    "gaps": [],
    "reviewerNotes": [
      {
        "type": "contradiction | undefined-term | thin-area | needs-review",
        "topic": "",
        "description": "",
        "affectedModules": ["module-1"]
      }
    ]
  },
  "learningObjectives": [
    { "id": "LO1", "text": "", "primaryModules": ["module-1"] }
  ],
  "modules": [
    {
      "moduleId": "module-1",
      "moduleNumber": 1,
      "moduleTitle": "",
      "moduleSummary": "",
      "objectivesCovered": ["LO1"],
      "keyTerms": ["Term A"],
      "sourceRefs": [
        "Format: <docLabel>: <page/section hint if available>"
      ],
      "sections": [
        {
          "sectionId": "m1-s1",
          "heading": "",
          "paragraphs": ["", ""],
          "doThis": ["Actionable step stated in sources"],
          "avoidThis": ["Common pitfall stated or implied by sources"],
          "signalsToEscalate": ["Only if the sources explicitly describe escalation triggers"],
          "sourceAnchors": [
            { "docId": "doc-1", "hint": "page 3, section 2.1" }
          ]
        }
      ],
      "slides": [
        {
          "slideTitle": "",
          "bullets": ["", "", ""],
          "sourceAnchors": [
            { "docId": "doc-1", "hint": "page 3, section 2.1" }
          ]
        }
      ]
    }
  ],
  "assessmentFocus": [
    {
      "moduleId": "module-1",
      "focusItems": [
        {
          "objectiveId": "LO1",
          "skill": "best-next-action | identify-noncompliance | sequence | escalation | modality-check",
          "whatToTest": "One sentence describing a real decision/step/risk from this module that is explicitly supported by the course content.",
          "commonMistake": "One sentence describing a plausible wrong move that conflicts with the course content.",
          "sourceAnchors": [
            { "docId": "doc-1", "hint": "page 3, section 2.1" }
          ]
        }
      ]
    }
  ]
}
\`\`\`

FINAL OUTPUT RULE:
- Output ONLY the JSON in the code fence. Nothing else.

SOURCE CONTENT:
${contextForGeneration}
`;
}

// ─── Prompt B — Quiz + Explanations ──────────────

export function buildPromptB(input: PromptBInput): string {
  return `
ROLE:
You are an assessment specialist generating a university-grade quiz for a regulated training course.

INPUTS:
1) Course JSON (authoritative) — output of Prompt A
2) requestedQuestionCount (integer set by admin)
3) quizDifficulty (one of: "easy", "medium", "hard")

GOAL:
Output ONE artifact ONLY:
- ONE valid JSON object in a markdown \`\`\`json fence
No other text.

HARD RULES:
- Use ONLY the provided Course JSON. No external knowledge.
- Do not invent policies, dates, rules, thresholds, timelines, roles, or procedures.
- Preserve modality exactly as written in Course JSON (must/should/may). Do NOT strengthen obligation language.
- If course.meta.status is not "ok", output a valid empty quiz with meta.gaps explaining why.

ROLES (whitelist rule):
- You may mention a specific role ONLY if that exact role term appears in Course JSON text (modules.sections.paragraphs or doThis/avoidThis/signalsToEscalate).
- Otherwise use neutral actors: "a staff member", "a team member".

ADMIN CONTROLS (must follow):
- requestedQuestionCount is the target.
- Minimum floor: 8 questions (if requestedQuestionCount < 8, generate 8 and log reviewerNotes type "min-floor-applied").
- Maximum cap: 30 questions (if requestedQuestionCount > 30, generate 30 and log reviewerNotes type "max-cap-applied").
- If the course is too thin to support the target without filler, generate fewer (but never below 8) and explain in meta.gaps and meta.coverageNote.

DIFFICULTY MODE (must follow):
- "easy": mostly 1-step application in a clean scenario (NOT definition-only).
- "medium": multi-step application OR mismatch/sequence error detection.
- "hard": prioritization under constraints, escalation tradeoffs, modality nuance.
Include a small number of easier items even in hard mode, but skew toward the selected difficulty.

ANTI-TRASH RULE:
Do NOT write stems like:
- "According to Module X..."
- "What did the module say..."
- "Which statement is mentioned..."
If you catch yourself doing this, rewrite.

SCENARIO-FIRST ENFORCEMENT:
- Every question.text MUST begin with "Scenario: " (exactly).
- No module references inside stems.
- No asking about headings/titles.

SCENARIO SAFETY (no-new-facts):
- You MAY add neutral context (a staff member, a client, a record, a handoff).
- You MUST NOT add policy-specific details not stated in the Course JSON (deadlines, approvals, required forms, exact step counts, implied exceptions).
- If the course does not specify a detail, keep it generic.

QUESTION QUALITY (university-grade):
- Focus on applying steps, choosing best action, detecting noncompliance, correct sequence, escalation, and modality-check.
- Distractors must be plausible mistakes using course terminology incorrectly (wrong sequence, wrong modality, wrong scope, missed escalation).
- Avoid "all of the above" and "none of the above" unless explicitly supported by Course JSON.
- Ensure ONE defensible best answer (ambiguity check).

ARCHETYPES (light but measurable):
Each question.archetype must be one of:
- "best-next-action"
- "identify-noncompliance"
- "sequence"
- "escalation"
- "modality-check"

Archetype guidance by difficulty:
- easy: at least 60% best-next-action or modality-check
- medium: at least 60% best-next-action, identify-noncompliance, or sequence
- hard: at least 70% best-next-action, escalation, identify-noncompliance, or modality-check

COVERAGE:
- Aim each module has at least 1 question if possible.
- Attempt to cover each LO at least once before repeating, if feasible.
- Use course.assessmentFocus as the primary pool of question ideas.

TRACEABLE EVIDENCE:
- Every question must include evidence.sourceAnchors copied from the most relevant:
  - focusItem.sourceAnchors OR module.section.sourceAnchors OR module.slide.sourceAnchors.
- This supports auditability without heavy quoting.

OUTPUT REQUIREMENTS:
- Required keys must exist. Extra keys are allowed ONLY if they do not remove/rename required keys.

JSON RELIABILITY:
- Double quotes only.
- Avoid inner quotes in strings (rephrase). If unavoidable, escape as \\".
- Avoid newlines inside JSON strings (use \\n if unavoidable).

OUTPUT SCHEMA (required keys and structure):
\`\`\`json
{
  "meta": {
    "promptVersion": "v3.1",
    "requestedQuestionCount": 0,
    "quizDifficulty": "",
    "totalQuestions": 0,
    "moduleCount": 0,
    "objectiveCount": 0,
    "coverageNote": "",
    "archetypeCounts": {
      "best-next-action": 0,
      "identify-noncompliance": 0,
      "sequence": 0,
      "escalation": 0,
      "modality-check": 0
    },
    "gaps": [],
    "reviewerNotes": []
  },
  "questions": [
    {
      "id": "q01",
      "moduleId": "module-1",
      "moduleNumber": 1,
      "moduleTitle": "",
      "objectiveId": "LO1",
      "difficulty": "easy",
      "archetype": "best-next-action",
      "text": "Scenario: ...",
      "options": ["", "", "", ""],
      "correctAnswer": 0,
      "evidence": {
        "moduleSectionId": "m1-s1",
        "moduleSectionHeading": "",
        "sourceAnchors": [
          { "docId": "doc-1", "hint": "page 3, section 2.1" }
        ]
      },
      "explanation": {
        "correctExplanation": "",
        "incorrectOptions": {
          "1": "",
          "2": "",
          "3": ""
        }
      },
      "qualityFlags": ["scenario-first-ok", "no-new-facts-ok", "single-best-answer-ok"]
    }
  ]
}
\`\`\`

EXPLANATION RULES:
- correctExplanation: 25–55 words, grounded in Course JSON content.
- incorrectOptions: 12–30 words each, naming the exact mismatch (wrong step, wrong modality, wrong sequence, missed escalation, wrong scope).
- incorrectOptions must include ONLY wrong indices (exclude correctAnswer index).
- Keys must be strings: "0","1","2","3" (include only wrong ones).

INTEGRITY CHECK (do internally):
- meta.totalQuestions equals questions.length
- meta.archetypeCounts equals actual count across questions
- One explanation per question
- No incorrectOptions includes correctAnswer index

FINAL OUTPUT RULE:
- Output ONLY the JSON in the code fence. Nothing else.

INPUTS:
requestedQuestionCount:
${input.requestedQuestionCount}

quizDifficulty:
${input.quizDifficulty}

COURSE JSON:
${input.courseJson}
`;
}
