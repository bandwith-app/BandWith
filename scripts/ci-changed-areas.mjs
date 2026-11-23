#!/usr/bin/env node
/**
 * CI: does this change need the app's E2E shards?
 *
 * No when every changed file is documentation (docs/, top-level *.md) or the
 * product site (site/), which has its own build and its own Playwright job.
 * Anything else, an empty list or a list we cannot read means yes.
 *
 * Usage: git diff --name-only origin/main...HEAD | node scripts/ci-changed-areas.mjs
 * Prints "app=true" or "app=false" (the line goes to $GITHUB_OUTPUT).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKIPS_APP_E2E = [/^docs\//, /^site\//, /^[^/]+\.md$/];

/** @param {string[]} files changed paths, repo-relative */
export function needsAppE2E(files) {
  const list = files.map((f) => f.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return !list.every((f) => SKIPS_APP_E2E.some((re) => re.test(f)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  try {
    input = readFileSync(0, 'utf8');
  } catch {
    input = '';
  }
  console.log(`app=${needsAppE2E(input.split('\n'))}`);
}
