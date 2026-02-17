# AI Prompts Reference

All AI prompts used in the LMS2 project.

---

## File: `src/app/actions/ai.ts`

> Uses Vertex AI SDK with `gemini-1.5-flash`

### Prompt 1 — `generateCourseFromDocument()` (line 54)

Generates a full course (lessons + quizzes) from a policy document.

```
You are an expert instructional designer. Based on the following policy document, create a comprehensive training course.

DOCUMENT CONTENT:
${documentContent.slice(0, 15000)}

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

---

### Prompt 2 — `generateQuizQuestions()` (line 121)

Generates quiz questions from existing lesson content.

```
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

## File: `src/app/actions/course-ai.ts`

> Uses Vertex AI REST API with `gemini-2.5-flash-lite`

### Prompt 3 — `generateCourseAI()` (line 91)

Main course generation prompt with full quiz configuration, citation support, and source material grounding.

```
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
3. **ESCAPE ALL newlines** within string values as \\n. Do not use literal control characters.
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

### Prompt 4 — `analyzeDocument()` (line 296)

Analyzes an uploaded document to extract course metadata (title, description, objectives, duration, quiz title).

```
You are an expert instructional designer. Analyze the following document text and extract key course metadata.

DOCUMENT TEXT START:
${truncatedText}
DOCUMENT TEXT END

Output a valid JSON object with the following fields:
- title: A professional, engaging title for a training course based on this content.
- description: A concise (2-3 sentences) summary of what this course covers.
- objectives: An array of 3-5 distinct learning objectives (start with action verbs).
- duration: Estimated time in minutes to read/complete this content (just the number, e.g. "45").
- quizTitle: A relevant title for the assessment quiz (e.g. "Knowledge Check: [Topic]").

Return ONLY valid JSON.
```
