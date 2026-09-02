/**
 * Test-only stand-in for the `server-only` package.
 *
 * The real package throws on import outside a React Server Component module
 * graph, which is every file in this jsdom test suite. Aliased in
 * vitest.config.mts so a module can declare `import 'server-only'` — and keep
 * that guard enforced by `next build` — without breaking the tests of anything
 * that transitively imports it.
 *
 * Intentionally empty; importing it must have no effect.
 */
export {};
