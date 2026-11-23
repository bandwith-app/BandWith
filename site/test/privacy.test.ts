import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * The product site must not send visitors' IP addresses to third parties it
 * doesn't name in the Privacy Policy (Google Analytics loads only after the
 * visitor accepts: e2e/site/consent.spec.ts). Fonts are self-hosted
 * (site/public/fonts); Google Fonts hosts must never come back.
 */
const SITE = path.resolve(__dirname, '..');
// it/ and es/ are generated copies of the English pages (site/tools/i18n.ts), checked through them.
const SKIP = new Set(['node_modules', 'dist', 'public', 'test', 'it', 'es']);
const BANNED = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SITE);
const pages = files.filter((f) => f.endsWith('index.html'));
const partial = (name: string) => readFileSync(path.join(SITE, 'partials', `${name}.html`), 'utf8');
// Same include rule as the bw-partials plugin in site/vite.config.ts (two passes).
const expand = (html: string) => html.replace(/<!--#([a-z-]+)-->/g, (_, n: string) => partial(n));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('site privacy: no third-party font hosts', () => {
  it('finds the site pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
  });

  for (const page of pages) {
    const rel = path.relative(SITE, page);
    it(`${rel} loads nothing from Google Fonts`, () => {
      const html = expand(expand(readFileSync(page, 'utf8')));
      expect(html).toContain('<head');
      for (const host of BANNED) expect(html, `${rel} → ${host}`).not.toContain(host);
    });
  }

  it('no site source, style or partial points at Google Fonts', () => {
    for (const f of files.filter((x) => /\.(ts|css|html)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      for (const host of BANNED) expect(src, `${path.relative(SITE, f)} → ${host}`).not.toContain(host);
    }
  });

  it('self-hosts Geist Mono with its OFL licence next to the files', () => {
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    const geist = faces.filter((f) => /font-family:\s*'Geist Mono'/.test(f));
    expect(geist.length).toBeGreaterThanOrEqual(2);
    for (const face of geist) {
      for (const [, url] of face.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
        expect(url.startsWith('/fonts/'), url).toBe(true);
        expect(existsSync(path.join(SITE, 'public', url)), url).toBe(true);
      }
    }
    expect(readFileSync(path.join(SITE, 'public/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
});

describe('Privacy Policy covers the website', () => {
  const policy = readFileSync(path.resolve(SITE, '../public/legal/privacy.html'), 'utf8');
  // Every third-party host a site page loads must be named in the policy.
  const PROVIDERS: Record<string, string> = {
    'use.typekit.net': 'Adobe Fonts',
    'www.googletagmanager.com': 'Google (Google Analytics)',
  };

  it('names the provider of every external host the site pages load', () => {
    for (const page of pages) {
      const html = expand(expand(readFileSync(page, 'utf8')));
      for (const [, host] of html.matchAll(/<(?:link|script)[^>]+(?:href|src)="https:\/\/([^/"]+)/g)) {
        expect(PROVIDERS[host], `${path.relative(SITE, page)} loads ${host}: add it to PROVIDERS and the policy`).toBeDefined();
        expect(policy).toContain(PROVIDERS[host]);
      }
    }
  });

  it('covers bandwith.fun, the waitlist, logs, country and language, run by an individual', () => {
    expect(policy).toContain('id="website"');
    expect(policy).toContain('https://bandwith.fun');
    for (const s of ['Waitlist', '12 months', 'Vercel', 'not stored', 'local storage', 'an individual']) expect(policy, s).toContain(s);
    expect(policy).not.toContain('Aria,');
    expect(policy).toContain('mailto:ciao@bandwith.fun');
    expect(policy).not.toContain('gianlucaboccia.me');
  });
});

describe('Terms of Service', () => {
  const terms = readFileSync(path.resolve(SITE, '../public/legal/terms.html'), 'utf8');
  it('names the same operator as the Privacy Policy: an individual, not "Aria"', () => {
    expect(terms).not.toContain('Aria,');
    expect(terms).toContain('Gianluca Boccia, an individual based in New Jersey, United States');
    expect(terms).toContain('mailto:ciao@bandwith.fun');
  });

  it('is governed by New Jersey law and keeps consumers\' home-country protection', () => {
    expect(terms).not.toContain('governed by Italian law');
    expect(terms).toContain('governed by the laws of the State of New Jersey');
    expect(terms).toContain('mandatory laws of the country where you live');
  });
});

describe('Privacy Policy in Italian and Spanish', () => {
  const LEGAL = path.resolve(SITE, '../public/legal');
  const en = readFileSync(path.join(LEGAL, 'privacy.html'), 'utf8');
  const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const rows = (html: string) => (html.match(/<tr>/g) ?? []).length;
  const h2 = (html: string) => (html.match(/<h2/g) ?? []).length;

  it('the English policy links both translations', () => {
    expect(en).toContain('href="privacy-it.html"');
    expect(en).toContain('href="privacy-es.html"');
  });

  for (const [lang, words] of [
    ['it', ['Lista d’attesa', '12 mesi', 'persona fisica', 'Adobe Fonts', 'non viene salvato']],
    ['es', ['Lista de espera', '12 meses', 'persona física', 'Adobe Fonts', 'no se guarda']],
  ] as const) {
    it(`privacy-${lang}.html mirrors the English policy`, () => {
      const file = path.join(LEGAL, `privacy-${lang}.html`);
      expect(existsSync(file), file).toBe(true);
      const html = readFileSync(file, 'utf8');
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain('href="privacy.html"');
      expect(ids(html)).toEqual(ids(en));
      expect(h2(html)).toBe(h2(en));
      expect(rows(html)).toBe(rows(en));
      expect(html).toContain('mailto:ciao@bandwith.fun');
      expect(html).toContain(en.match(/Last updated: ([^<]+)/)?.[1].split(' ')[0] ?? 'x');
      for (const w of words) expect(html, w).toContain(w);
    });
  }
});

describe('Privacy Policy covers Google Analytics on the website (consent only)', () => {
  const LEGAL = path.resolve(SITE, '../public/legal');
  const GA_HOSTS = ['googletagmanager.com', 'google-analytics.com'];
  const COPY = {
    en: { file: 'privacy.html', banner: 'Cookie preferences', consent: 'only if you agree', retention: 'Website statistics' },
    it: { file: 'privacy-it.html', banner: 'Preferenze cookie', consent: 'solo se accetti', retention: 'Statistiche del sito' },
    es: { file: 'privacy-es.html', banner: 'Preferencias de cookies', consent: 'solo si aceptas', retention: 'Estadísticas del sitio web' },
  } as const;

  for (const [lang, c] of Object.entries(COPY)) {
    it(`${c.file} names Google Analytics, its cookies, the consent and how to withdraw it`, () => {
      const html = readFileSync(path.join(LEGAL, c.file), 'utf8');
      expect(html, lang).toContain('<tr><td>Google (Google Analytics)</td>');
      for (const s of ['_ga', '_ga_GCWSEQRZ2E', c.banner, c.consent, c.retention]) expect(html, `${lang}: ${s}`).toContain(s);
      expect(html, `${lang}: no "no cookies" claim`).not.toMatch(/uses no cookies|non usa cookie|no usa cookies/);
    });
  }

  it('any site code that talks to Google Analytics is covered by the policy', () => {
    const en = readFileSync(path.join(LEGAL, 'privacy.html'), 'utf8');
    for (const f of files.filter((x) => /\.(ts|html)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      if (GA_HOSTS.some((h) => src.includes(h))) expect(en, path.relative(SITE, f)).toContain('Google (Google Analytics)');
    }
  });
});

/**
 * The app sends error reports by default (Settings › Privacy & account ›
 * Send crash reports) and, with consent, native crashes to Firebase
 * Crashlytics. The policy said nothing about either until 11-23.
 */
describe('Privacy Policy covers error reports', () => {
  const LEGAL = path.resolve(SITE, '../public/legal');
  const policies: Record<string, { file: string; setting: string; days: string; updated: string }> = {
    en: { file: 'privacy.html', setting: 'Send crash reports', days: '14 days', updated: 'Last updated: 23 November 2026' },
    it: { file: 'privacy-it.html', setting: 'Invia segnalazioni di errore', days: '14 giorni', updated: 'Ultimo aggiornamento: 23 novembre 2026' },
    es: { file: 'privacy-es.html', setting: 'Enviar informes de errores', days: '14 días', updated: 'Última actualización: 23 de noviembre de 2026' },
  };

  for (const [lang, p] of Object.entries(policies)) {
    it(`${lang}: what is sent, how long it is kept, how to switch it off, and Crashlytics`, () => {
      const html = readFileSync(path.join(LEGAL, p.file), 'utf8');
      // The item itself, with the name of the setting as the app shows it in that language.
      const item = /<li id="error-reports">([\s\S]*?)<\/li>/.exec(html)?.[1] ?? '';
      expect(item, 'the error-reports item').not.toBe('');
      expect(item).toContain(p.setting);
      expect(item).toContain(p.days);
      expect(item).toContain('Firebase Crashlytics');
      // Purposes table, processors table and retention list each name it.
      expect(html.match(/Art\. 6\(1\)\(f\)|art\. 6, par\. 1, lett\. f|art\. 6\.1\.f/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(html).toMatch(/<tr><td>Google \(Firebase Crashlytics\)<\/td>/);
      expect(html.split(p.days).length - 1).toBeGreaterThanOrEqual(2);
      expect(html).toContain(p.updated);
    });
  }

  it('the summary no longer says nothing is collected without a yes', () => {
    const html = readFileSync(path.join(LEGAL, 'privacy.html'), 'utf8');
    const short = /<strong>In short\.<\/strong>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(short).toMatch(/error reports/i);
  });
});
