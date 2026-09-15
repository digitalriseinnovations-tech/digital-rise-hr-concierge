// Stub for Next.js's "server-only" import guard, which is handled specially
// by Next's bundler and doesn't resolve as a real package under Vitest
// (which runs library code directly in Node, not through Next's bundler).
// A no-op here is correct: the guard's purpose (fail a build if this module
// is imported from client code) doesn't apply when Vitest runs src/lib
// files directly in a Node test process.
export {};
