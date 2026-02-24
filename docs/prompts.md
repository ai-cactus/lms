# AI Prompts Overview

This document summarizes the AI prompts currently used in the **lms2** project for course generation, quiz creation, and answer explanations.

## 1. Course Material (Long Form & Slides)

The project uses two slightly different prompts for course generation depending on the context. Both generate HTML content that is used for both the "Article" (long form) and "Slide" (presentation) view modes.

### Option A: Course Generation (from Policy Documents)
**Location:** `src/app/actions/ai.ts`

```text
You are an expert instructional designer. Based on the following policy document, create a comprehensive training course.

DOCUMENT CONTENT:
${truncateToContext(documentContent, MAX_DOCUMENT_TOKENS)}

REQUIREMENTS:
- Category: ${category}
- Difficulty: ${difficulty}
- Number of lessons: ${lessonCount}
- Questions per lesson: ${questionsPerLesson}

Generate a JSON response with this exact structure:
{
  "title": "Course title based on document",
  "description": "2-3 sentence course description",
  "difficulty": "${difficulty}",
  "lessons": [
    {
      "title": "Lesson 1 title",
      "content": "Full lesson content in HTML format with <h3>, <p>, <ul>, <li> tags. Should be comprehensive and educational, 300-500 words.",
      "duration": 10,
      "quiz": {
        "title": "Lesson 1 Quiz",
        "questions": [
          {
            "text": "Question text?",
            "type": "multiple_choice",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correctAnswer": "Option A"
          }
        ]
      }
    }
  ]
}

Make the content educational, engaging, and based directly on the provided document. Include practical examples and key compliance points.
```

### Option B: Comprehensive Course & Quiz Outline
**Location:** `src/app/actions/course-ai.ts`

```text
You are an expert instructional designer. Create a comprehensive course outline and quiz for a Learning Management System.

COURSE INFORMATION:
Topic/Title: ${data.title}
Category: ${data.category}
Description: ${data.description}
Estimated Course Duration: ${data.duration} minutes total
Number of Modules/Sections: ${data.notesCount || '5'} modules

LEARNING OBJECTIVES (users should achieve these by course end):
${data.objectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n        ')}

SOURCE MATERIAL:
${sourceText ? `Use the following text as the GROUND TRUTH for the course content. 
IMPORTANT: CITATION REQUIREMENT
- When writing the module content, whenever you state a fact derived from the source text, append a citation marker like [1], [2], etc.
- You MUST include a "citations" array in the JSON output.
- Each citation object must include the "id" (number) and the "quote" (EXACT text segment from the source).

SOURCE TEXT START:
${sourceText}
SOURCE TEXT END` : 'No source document provided. Generate content based on general knowledge.'}

QUIZ CONFIGURATION:
Quiz Title: ${data.quizTitle}
Number of Questions: ${data.quizQuestionCount}
Question Type: ${data.quizQuestionType || 'Multiple Choice'}
Estimated Quiz Duration: ${data.quizDuration} minutes
Passing Score Target: ${data.quizPassMark} (design questions so this pass rate is achievable but meaningful)
Difficulty Level: ${data.quizDifficulty || 'Moderate'} (Adjust question complexity accordingly)

QUESTION TYPE INSTRUCTIONS:
- If Question Type is "Multiple Choice": Provide 4 options for each question. Start options with capital letters.
- If Question Type is "True / False": Provide EXACTLY 2 options: ["True", "False"].
- If Question Type is "Mixed": Generate a mix of "Multiple Choice" and "True / False" questions. Roughly 50/50 mix.

CRITICAL OUTPUT INSTRUCTIONS:
1. Return ONLY a valid JSON object. No markdown formatting (no ```json), no introductory text.
2. **Output MINIFIED JSON (single line)** to avoid formatting errors.
3. **ESCAPE ALL newlines** within string values as \n. Do not use literal control characters.
4. Create EXACTLY ${data.notesCount || '5'} modules to match user's preference.
5. Design quiz with EXACTLY ${data.quizQuestionCount} questions.
6. The JSON must strictly match this schema:
{
    "modules": [
        {
            "title": "Module Title",
            "content": "Detailed HTML content...",
            "duration": "X min"
        }
    ],
    "quiz": [
        {
            "question": "Question text",
            "type": "multiple_choice" | "true_false",
            "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
            "answer": 0
        }
    ],
    "citations": [
        {
            "id": 1,
            "quote": "Exact text...",
            "comment": "Optional"
        }
    ]
}
7. Total module durations should add up to approximately ${data.duration} minutes.
8. Ensure the quiz tests the learning objectives.
9. DO NOT USE PLACEHOLDERS.
```

---

## 2. Quiz Questions and Answers

In addition to the quizzes generated within the course prompts above, there is a dedicated prompt for generating quiz questions for existing lesson content.

**Location:** `src/app/actions/ai.ts`

```text
Based on the following lesson content, generate ${count} quiz questions.

LESSON CONTENT:
${lessonContent}

Generate a JSON array of questions:
[
  {
    "text": "Question text?",
    "type": "multiple_choice",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "Option A"
  }
]

Make questions that test understanding of key concepts from the lesson.
```

---

## 3. Answer Explanations

This prompt is used when a user submits a quiz to generate concise educational explanations for each question.

**Location:** `src/app/api/quiz/[id]/submit/route.ts`

```text
For each quiz question below, provide a concise 1-2 sentence explanation of WHY the correct answer is correct. Be educational and clear.

Questions:
${questionsForAI.map(q => `${q.num}. "${q.question}" — Correct answer: "${q.correctAnswer}" (Options: ${q.options.join(', ')})`).join('\n')}

Return ONLY a JSON object mapping question numbers to explanations, like:
{"1": "Explanation for Q1...", "2": "Explanation for Q2...", ...}
No markdown, no extra text.
```

---

## Additional AI Prompts Found

### Document Analysis (Metadata Extraction)
Analyzes a document to extract titles, descriptions, objectives, and durations.
**Location:** `src/app/actions/course-ai.ts`

### PHI Scanning (Privacy Compliance)
Scans uploaded documents for Protected Health Information (PHI) under HIPAA.
**Location:** `src/lib/documents/phiScanner.ts` and `src/app/actions/course-ai.ts`
