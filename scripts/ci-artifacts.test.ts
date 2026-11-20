/**
 * CI keeps the Playwright traces of a failed run. They live in dot folders
 * (e2e/.results, e2e/.report), and actions/upload-artifact@v4 skips hidden
 * files unless `include-hidden-files: true`: on 11-20 a failing E2E shard
 * uploaded nothing ("No files were found with the provided path").
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = path.resolve(__dirname, '../.github/workflows');

/** Every upload-artifact step: its text, up to the next step. */
function uploadSteps(file: string): string[] {
  const lines = readFileSync(path.join(WORKFLOWS, file), 'utf8').split('\n');
  const steps: string[] = [];
  lines.forEach((line, i) => {
    if (!/uses:\s*actions\/upload-artifact@/.test(line)) return;
    // The step starts at the closest "- " line above, and ends before the next one.
    let start = i;
    while (start > 0 && !/^\s*- /.test(lines[start])) start--;
    const indent = lines[start].search(/\S/);
    let end = i + 1;
    while (end < lines.length && !(lines[end].trim() && lines[end].search(/\S/) <= indent)) end++;
    steps.push(lines.slice(start, end).join('\n'));
  });
  return steps;
}

const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const steps = files.flatMap((f) => uploadSteps(f).map((step) => ({ file: f, step })));

describe('CI artifact uploads', () => {
  it('finds the E2E report uploads', () => {
    expect(steps.filter(({ step }) => step.includes('e2e/.results')).length).toBeGreaterThanOrEqual(2);
  });

  for (const { file, step } of steps) {
    const hidden = /^\s+[\w./-]*\/\.[\w-]+/m.test(step.split(/path:/)[1] ?? '');
    if (!hidden) continue;
    const name = /name:\s*(.+)/.exec(step.split('with:')[1] ?? '')?.[1]?.trim() ?? '?';
    it(`${file} › ${name}: uploads its dot folders (include-hidden-files: true)`, () => {
      expect(step).toMatch(/include-hidden-files:\s*true/);
    });
  }
});
