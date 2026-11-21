/**
 * The install guides on /get/: every site language shows its own videos (EN at /get/, IT at /it/get/,
 * ES at /es/get/), wide on large screens and tall on phones, and every file they point to exists.
 */
import { describe, expect, it as test } from 'vitest';
import { JSDOM } from 'jsdom';
import { existsSync } from 'fs';
import path from 'path';
import { englishPage } from '../tools/pages';
import { finalizePage } from '../tools/i18n';

const PUBLIC = path.resolve(__dirname, '../public');
const REL = 'get/index.html';

describe('install guide videos on /get/', () => {
  for (const lang of ['en', 'it', 'es'] as const) {
    test(`${lang}: both guides, both formats, in ${lang}, files present`, () => {
      const doc = new JSDOM(finalizePage(englishPage(REL), REL, lang)).window.document;
      for (const g of ['android', 'ios']) {
        const fig = doc.getElementById(`watch-${g}`);
        expect(fig, `#watch-${g}`).not.toBeNull();
        const vids = [...fig!.querySelectorAll('video')];
        expect(vids.map((v) => v.className)).toEqual(['gvid__v gvid__v--wide', 'gvid__v gvid__v--tall']);
        for (const v of vids) {
          expect(v.getAttribute('preload')).toBe('none');
          const urls = [v.getAttribute('poster')!, v.querySelector('source')!.getAttribute('src')!];
          for (const u of urls) {
            expect(u.startsWith(`/videos/install/${lang}/${g}-`), u).toBe(true);
            expect(existsSync(path.join(PUBLIC, u)), u).toBe(true);
          }
        }
        // the door links to its video
        expect(doc.querySelector(`a.gdoor__watch[href="#watch-${g}"]`)).not.toBeNull();
      }
    });
  }
});
