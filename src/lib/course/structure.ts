/**
 * Whole-course vs modular structure, derived from how many modules a course
 * carries. There is no column for it: `Course.type` already means something
 * else (`text` | `video`), and a count is authoritative wherever the modules
 * themselves are loaded.
 */

/**
 * `<= 1`, not `=== 1`: legacy single-document courses were created before the
 * module builder existed and have zero `CourseModule` rows, yet they are whole
 * courses exactly like a one-module course is.
 *
 * A whole course is the degenerate 1-module case of the SAME generation
 * fan-out, not a second pipeline: `GenerationController` starts one job per
 * module, `distributeQuestionCount` hands a single module the full question
 * count, and merging one module's artifacts is an identity fold. Nothing
 * downstream needs a whole-course branch.
 */
export function isWholeCourse(moduleCount: number): boolean {
  return moduleCount <= 1;
}
