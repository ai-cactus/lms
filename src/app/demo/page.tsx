"use client";

import { useState } from "react";
import { CourseViewer } from "@/components/course-viewer";
import { QuizInterface } from "@/components/quiz-interface";

const SAMPLE_COURSE = `# Advanced Calculus: Limits and Derivatives

## Course Overview
This course explores the fundamental concepts of calculus, focusing on limits, continuity, and derivatives. You'll learn how to analyze functions, understand rates of change, and apply these concepts to real-world problems.

---

## Module 1: Understanding Limits

### What is a Limit?
A **limit** describes the value that a function approaches as the input approaches some value. Mathematically, we write:

$$\\lim_{x \\to a} f(x) = L$$

This means: "As $x$ gets closer to $a$, $f(x)$ gets closer to $L$."

### Key Properties of Limits
1. **Sum Rule**: $\\lim_{x \\to a} [f(x) + g(x)] = \\lim_{x \\to a} f(x) + \\lim_{x \\to a} g(x)$
2. **Product Rule**: $\\lim_{x \\to a} [f(x) \\cdot g(x)] = \\lim_{x \\to a} f(x) \\cdot \\lim_{x \\to a} g(x)$
3. **Quotient Rule**: $\\lim_{x \\to a} \\frac{f(x)}{g(x)} = \\frac{\\lim_{x \\to a} f(x)}{\\lim_{x \\to a} g(x)}$ (if denominator ≠ 0)

### Example Problem
Find $\\lim_{x \\to 2} (3x^2 + 2x - 1)$

**Solution:**
\`\`\`
Step 1: Substitute x = 2
Step 2: 3(2)² + 2(2) - 1
Step 3: 3(4) + 4 - 1
Step 4: 12 + 4 - 1 = 15
\`\`\`

Therefore, $\\lim_{x \\to 2} (3x^2 + 2x - 1) = 15$

---

## Module 2: Continuity

### Definition of Continuity
A function $f(x)$ is **continuous** at $x = a$ if:
1. $f(a)$ is defined
2. $\\lim_{x \\to a} f(x)$ exists
3. $\\lim_{x \\to a} f(x) = f(a)$

### Types of Discontinuities

| Type | Description | Example |
|------|-------------|---------|
| **Removable** | A "hole" in the graph | $f(x) = \\frac{x^2-1}{x-1}$ at $x=1$ |
| **Jump** | Function "jumps" to different value | Piecewise functions |
| **Infinite** | Function approaches infinity | $f(x) = \\frac{1}{x}$ at $x=0$ |

### Intermediate Value Theorem
> **Theorem**: If $f$ is continuous on $[a, b]$ and $N$ is between $f(a)$ and $f(b)$, then there exists $c$ in $(a, b)$ such that $f(c) = N$.

This theorem guarantees that continuous functions take on all intermediate values!

---

## Module 3: Derivatives

### The Derivative Concept
The **derivative** of a function measures its instantaneous rate of change. It's defined as:

$$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$$

### Common Derivative Rules

1. **Power Rule**: If $f(x) = x^n$, then $f'(x) = nx^{n-1}$
2. **Constant Multiple**: $(cf)' = cf'$
3. **Sum Rule**: $(f + g)' = f' + g'$
4. **Product Rule**: $(fg)' = f'g + fg'$
5. **Quotient Rule**: $\\left(\\frac{f}{g}\\right)' = \\frac{f'g - fg'}{g^2}$
6. **Chain Rule**: $(f \\circ g)' = f'(g(x)) \\cdot g'(x)$

### Practical Example: Velocity and Acceleration
If the position of an object is given by $s(t) = 16t^2$ (in feet), then:

- **Velocity** = $v(t) = s'(t) = 32t$ ft/s
- **Acceleration** = $a(t) = v'(t) = 32$ ft/s²

At $t = 3$ seconds:
- Position: $s(3) = 16(3)^2 = 144$ feet
- Velocity: $v(3) = 32(3) = 96$ ft/s
- Acceleration: $a(3) = 32$ ft/s²

---

## Module 4: Applications of Derivatives

### Finding Critical Points
To find where a function has maximum or minimum values:

1. Find $f'(x)$
2. Set $f'(x) = 0$ and solve for $x$
3. Test points around critical values

### Optimization Example
**Problem**: A farmer has 100 meters of fence. What dimensions maximize the rectangular area?

**Solution:**
- Let width = $w$ and length = $l$
- Constraint: $2w + 2l = 100$, so $l = 50 - w$
- Area: $A(w) = w \\cdot l = w(50 - w) = 50w - w^2$
- Derivative: $A'(w) = 50 - 2w$
- Critical point: $50 - 2w = 0 \\Rightarrow w = 25$
- Therefore: $l = 25$

**Answer**: A square with sides of 25 meters maximizes the area!

### Related Rates
When multiple quantities change with respect to time, we use the **chain rule** to relate their rates of change.

**Example**: A ladder 10 ft long leans against a wall. If the bottom slides away at 2 ft/s, how fast is the top sliding down when the bottom is 6 ft from the wall?

Using Pythagorean theorem: $x^2 + y^2 = 100$

Differentiating: $2x\\frac{dx}{dt} + 2y\\frac{dy}{dt} = 0$

When $x = 6$: $y = 8$

Solving: $\\frac{dy}{dt} = -\\frac{x}{y} \\cdot \\frac{dx}{dt} = -\\frac{6}{8} \\cdot 2 = -1.5$ ft/s

---

## Summary

In this course, you've learned:

✓ How to evaluate limits using algebraic techniques  
✓ The definition and importance of continuity  
✓ How to compute derivatives using various rules  
✓ Real-world applications including optimization and related rates  

These concepts form the foundation of calculus and are essential for advanced mathematics, physics, engineering, and economics!
`;

const SAMPLE_QUIZ = [
    {
        id: "1",
        text: "What is the limit of f(x) = 3x² + 2x - 1 as x approaches 2?",
        options: ["13", "15", "17", "19"],
        correctAnswer: 1
    },
    {
        id: "2",
        text: "Which condition is NOT required for a function to be continuous at x = a?",
        options: [
            "f(a) is defined",
            "lim(x→a) f(x) exists",
            "f'(a) exists",
            "lim(x→a) f(x) = f(a)"
        ],
        correctAnswer: 2
    },
    {
        id: "3",
        text: "Using the power rule, what is the derivative of f(x) = x⁵?",
        options: ["x⁴", "5x⁴", "5x⁵", "x⁵/5"],
        correctAnswer: 1
    },
    {
        id: "4",
        text: "A farmer has 100 meters of fence. What shape maximizes the rectangular area?",
        options: [
            "Rectangle with length 40m and width 10m",
            "Square with sides 25m",
            "Rectangle with length 30m and width 20m",
            "Rectangle with length 50m and width 0m"
        ],
        correctAnswer: 1
    }
];

export default function DemoPage() {
    const [view, setView] = useState<"course" | "quiz">("course");

    if (view === "quiz") {
        return <QuizInterface questions={SAMPLE_QUIZ} onRetake={() => setView("course")} />;
    }

    return <CourseViewer content={SAMPLE_COURSE} onComplete={() => setView("quiz")} />;
}
