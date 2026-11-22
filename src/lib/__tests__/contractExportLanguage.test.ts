/**
 * Codex round 3 on #293 (contracts.ts:267): open an Italian contract in a
 * fresh English session and export it in French. Only the export language
 * was loaded, so the Italian standard terms were not recognised (their
 * dictionary still loading) and the first PDF printed them under French
 * headings. The test setup preloads every language; here only English is
 * loaded until loadLocale is called, as in a fresh session.
 */
import { describe, expect, it, vi } from 'vitest';
import contractsViewSrc from '../../app/views/ContractsView.tsx?raw';
import eventStageSrc from '../../app/components/event/rider/useEventStage.ts?raw';

const loaded = vi.hoisted(() => new Set<string>(['en']));
vi.mock('@/lib/i18n', async (orig) => {
  const real = await orig<typeof import('@/lib/i18n')>();
  return {
    ...real,
    translate: (l: Parameters<typeof real.translate>[0], s: string, v?: Parameters<typeof real.translate>[2]) =>
      real.translate(loaded.has(l) ? l : 'en', s, v),
    loadLocale: async (l: Parameters<typeof real.loadLocale>[0]) => {
      await real.loadLocale(l);
      loaded.add(l);
    },
  };
});
vi.mock('@/lib/supabase', () => ({ supabase: {}, getSafeUser: vi.fn() }));

import { translate } from '@/lib/i18n';
import * as contracts from '@/lib/services/contracts';

const pdfText = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(new TextDecoder('latin1').decode(new Uint8Array(r.result as ArrayBuffer)));
    r.onerror = () => fail(r.error);
    r.readAsArrayBuffer(blob);
  });

describe('contract export: the dictionaries are in before the PDF', () => {
  it('an Italian contract exported in French prints the French clauses, not the Italian ones', async () => {
    expect(typeof (contracts as any).buildContractPdfReady).toBe('function');
    // The Italian terms as the form inserted them (that session had Italian loaded).
    loaded.add('it');
    const italian = contracts.standardTerms('contract', 'it');
    loaded.delete('it');
    loaded.delete('fr');
    expect(italian).not.toBe(contracts.standardTerms('contract', 'en'));

    const blob = await contracts.buildContractPdfReady(
      { id: 'c-1', band_id: 'b-1', type: 'contract', title: 'Rooftop wedding', status: 'draft', content: italian } as any,
      { lang: 'fr', bandName: 'The Night Shift' },
    );
    const text = await pdfText(blob);
    const french = translate('fr', 'Performance: the band performs live at the event on the date and times agreed.');
    expect(french).not.toMatch(/^Performance: the band/);
    expect(text).toContain(french.split(/\s+/).slice(0, 2).join(' '));
    expect(text).not.toContain(italian.split(/\s+/).slice(0, 3).join(' '));
  });

  it('every screen that makes a contract PDF waits for the dictionaries', () => {
    for (const [file, src] of [['ContractsView.tsx', contractsViewSrc], ['useEventStage.ts', eventStageSrc]] as const) {
      expect(src, file).toContain('await buildContractPdfReady(');
      expect(src, file).not.toMatch(/[^.\w]buildContractPdf\(/);
    }
  });
});
