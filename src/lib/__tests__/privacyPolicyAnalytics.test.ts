/**
 * The Android and iOS apps send anonymous usage statistics to Google
 * Analytics for Firebase after the user's yes (src/lib/appAnalytics.ts).
 * Every edition of the Privacy Policy must say so, with the legal basis,
 * the provider and the retention, and must not claim "no analytics".
 */
import { describe, it, expect } from 'vitest';

// The app's tsconfig has no Node types, hence the loose import.
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (path: string, enc: 'utf8') => string };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8'); // vitest runs from the repo root

const editions = {
  en: { file: 'public/legal/privacy.html', denial: /don't use third-party analytics/, retention: /14 months/ },
  it: { file: 'public/legal/privacy-it.html', denial: /non usiamo strumenti di analisi/, retention: /14 mesi/ },
  es: { file: 'public/legal/privacy-es.html', denial: /no usamos herramientas de analítica/, retention: /14 meses/ },
};

describe.each(Object.entries(editions))('Privacy Policy (%s)', (_lang, e) => {
  const policy = read(e.file);

  it('names Google Analytics for Firebase as a provider', () => {
    expect(policy).toMatch(/<tr><td>Google \(Google Analytics for Firebase\)<\/td>/);
  });

  it('no longer says the apps use no analytics', () => {
    expect(policy).not.toMatch(e.denial);
  });

  it('gives consent as the legal basis and the 14-month retention', () => {
    expect(policy).toMatch(/Art\. 6\(1\)\(a\)|art\. 6, par\. 1, lett\. a|art\. 6\.1\.a/);
    expect(policy).toMatch(e.retention);
    expect(policy).toContain('id="usage-statistics"');
  });
});
