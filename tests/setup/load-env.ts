import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal, dependency-free .env.local loader for the test environment.
// Deliberately does not log anything — this file must never print a value.
// Mirrors what `next dev`/`next build` already do automatically for the
// app itself; tests need their own loader since Vitest doesn't run through
// Next.js's env pipeline.
const envPath = resolve(process.cwd(), ".env.local");

if (existsSync(envPath)) {
  const contents = readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching surrounding quotes — a common .env
    // convention this minimal loader must handle the same way dotenv does,
    // otherwise a quoted URL fails strict URL validation downstream.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
