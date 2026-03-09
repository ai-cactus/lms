# Core Operating Rules

## 1. Documentation-First Rule (Non-Negotiable)

For any library, framework, SDK, API, language feature, infrastructure tool, or external dependency:

* Always consult the **official documentation** before implementation.
* Prefer official docs over blog posts, StackOverflow answers, or memory.
* Follow the most current stable version unless explicitly instructed otherwise.
* Do not assume API behavior from prior knowledge.
* If documentation is unavailable or ambiguous, explicitly state that and proceed cautiously.

Never invent APIs. Never guess configuration fields.

---

## 2. Version Awareness Rule

* Identify the exact version of every framework or package in use.
* Ensure code is compatible with that version.
* Avoid deprecated APIs.
* If using a newer feature, confirm it is supported in the target runtime.

No silent version mismatches.

---

## 3. Simplicity Before Abstraction

* Implement the simplest solution that satisfies the requirements.
* Avoid premature abstraction.
* Avoid over-engineering.
* Introduce patterns (factory, strategy, repository, etc.) only when justified by scale or requirement.

Complexity must be earned.

---

## 4. Production-Ready by Default

Every implementation must assume production unless explicitly marked as prototype.

This includes:

* Input validation
* Proper error handling
* Structured logging
* Environment-based configuration
* Security considerations
* No hardcoded secrets
* No console debug leftovers
* No dead code

---

## 5. Security-First Rule

Always consider:

* Input sanitization
* Authentication & authorization boundaries
* Rate limiting (where relevant)
* Secure headers
* CSRF/XSS considerations (for web apps)
* Proper password hashing
* Principle of least privilege
* Secrets via environment variables

Never expose sensitive data in logs or responses.

---

## 6. Performance Awareness

* Avoid N+1 queries.
* Use proper indexing when database changes are involved.
* Avoid unnecessary re-renders (frontend).
* Avoid blocking operations in async environments.
* Prefer streaming or pagination for large datasets.

Performance issues should be prevented, not patched later.

---

## 7. Clean Architecture Alignment

* Respect separation of concerns.
* Keep business logic out of controllers.
* Keep persistence logic out of domain logic.
* Avoid tight coupling.
* Favor dependency injection when available.

No God classes.

---

## 8. Deterministic Output

* Avoid non-deterministic behavior.
* Avoid hidden global state.
* Make functions pure where possible.
* Explicit inputs → explicit outputs.

Predictability beats cleverness.

---

## 9. Error Handling Standard

* Never swallow errors.
* Never return vague error messages.
* Surface meaningful messages for developers.
* Return safe, non-sensitive messages for users.
* Use consistent error formats.

---

## 10. Testing Discipline

When generating features:

* Include unit tests for core logic.
* Mock external dependencies.
* Avoid testing implementation details.
* Cover edge cases.
* Ensure tests are deterministic.

If skipping tests, explicitly justify why.

---

## 11. Observability Built-In

For backend systems:

* Structured logs (not plain strings)
* Meaningful log levels (info, warn, error)
* Correlation IDs where applicable
* Health check endpoints
* Graceful shutdown handling

---

## 12. Idempotency & Reliability

For APIs:

* Ensure safe retries.
* Design idempotent endpoints where possible.
* Handle partial failure states.

Especially for payments, messaging, and external calls.

---

## 13. No Assumptions Rule

If requirements are unclear:

* State assumptions explicitly.
* Choose the safest and most conventional approach.
* Avoid inventing business logic.

---

## 14. Refactor Opportunistically

If existing code:

* Violates core principles
* Is clearly brittle
* Is insecure
* Is significantly inefficient

Refactor before building on top of it, and explain why.

---

## 15. Consistency Over Preference

Follow:

* Existing project structure
* Existing naming conventions
* Existing error format
* Existing logging style
* Existing lint rules

Do not introduce stylistic drift.

---

## 16. Documentation of Implementation

For non-trivial logic:

* Add concise inline comments explaining “why,” not “what.”
* Update README or relevant docs when behavior changes.
* Document environment variables.

---

## 17. Tooling Awareness

Prefer:

* Built-in framework features over custom hacks.
* Official SDKs over handcrafted integrations.
* Battle-tested libraries over obscure ones.

Avoid reinventing infrastructure.

---

## 18. Scalability Awareness

When designing:

* Assume growth in users, data, and complexity.
* Avoid designs that collapse under moderate scale.
* Prefer horizontal scalability patterns where relevant.

---

## 19. Fail Fast

* Validate early.
* Reject invalid input immediately.
* Do not allow corrupted state propagation.

---

## 20. Explicit Tradeoff Declaration

If making a tradeoff (speed vs abstraction, performance vs readability, etc.), explicitly state it.

---

# Optional: Strict Mode Add-On

> Before finalizing any implementation, internally evaluate:
>
> * Security
> * Performance
> * Maintainability
> * Scalability
> * Testability
> * Alignment with official documentation

If any category scores low, revise.
