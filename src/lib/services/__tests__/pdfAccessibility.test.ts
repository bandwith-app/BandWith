/**
 * Exported quotes and setlists are drawn on a canvas and saved as one JPEG
 * per page. A screen reader (with OCR off) must still read them: the PDF
 * carries a title, a language, and the text in reading order (tagged).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateSetlistPdf } from '../setlistPdf';
import { generateQuotePdf } from '../quotePdf';
import { DEFAULT_BAND_PRICING } from '../pricing';
import { setLocalePref } from '@/lib/i18n';
import { buildTaggedPdf } from '../pdfDocument';

// jsdom has no canvas: a 2D context that only measures text (10 px a char).
const fakeCtx = () => {
  const ctx: Record<string, unknown> = {
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText: (s: string) => ({ width: String(s).length * 10 }),
  };
  return new Proxy(ctx, {
    get: (o, k) => (k in o ? o[k as string] : () => undefined),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
};
// A JPEG start-of-image marker is enough for the PDF writer.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
let restore: () => void;
beforeAll(() => {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const was = { getContext: proto.getContext, toDataURL: proto.toDataURL };
  proto.getContext = function () {
    return fakeCtx();
  };
  proto.toDataURL = () => JPEG;
  restore = () => Object.assign(proto, was);
});
afterAll(() => restore());

const bytesOf = async (blob: Blob): Promise<string> => {
  const buf = await new Promise<ArrayBuffer>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.readAsArrayBuffer(blob);
  });
  return Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join('');
};
/** A PDF text string in UTF-16BE hex, as the writer stores titles and ActualText. */
const utf16 = (s: string) =>
  'FEFF' + Array.from(s, (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');

describe('setlist PDF is readable by a screen reader', () => {
  it('has a title, the app language, tags and every song as text, in order', async () => {
    setLocalePref('en');
    const { blob } = generateSetlistPdf({
      name: 'Friday Night',
      bandName: 'The Hudson Five',
      songs: [
        { title: 'Volare', artist: 'Domenico Modugno', key: 'G', bpm: 120, durationSeconds: 200, setNumber: 1 },
        { title: 'Café del Mar', setNumber: 2 },
      ],
    });
    const pdf = await bytesOf(blob);
    expect(pdf).toContain(`/Title <${utf16('Friday Night')}`);
    expect(pdf).toContain('/DisplayDocTitle true');
    expect(pdf).toMatch(/\/Lang \(en\)/);
    expect(pdf).toContain('/MarkInfo << /Marked true >>');
    expect(pdf).toContain('/StructTreeRoot');
    // The page picture is decoration; the words are real (invisible) text.
    expect(pdf).toContain('/Artifact BMC');
    expect(pdf).toContain('3 Tr');
    const volare = pdf.indexOf(`/ActualText <${utf16('Volare')}>`);
    const cafe = pdf.indexOf(`/ActualText <${utf16('Café del Mar')}>`);
    const details = pdf.indexOf(`/ActualText <${utf16('G  ·  120 BPM  ·  3:20')}>`);
    expect(volare).toBeGreaterThan(0);
    // Title first, then key · BPM · time, then the next song.
    expect(details).toBeGreaterThan(volare);
    expect(cafe).toBeGreaterThan(details);
  });

  it('follows the app language', async () => {
    await setLocalePref('it');
    const { blob } = generateSetlistPdf({ name: 'Venerdì', songs: [] });
    const pdf = await bytesOf(blob);
    expect(pdf).toMatch(/\/Lang \(it\)/);
    setLocalePref('en');
  });
});

describe('quote PDF is readable by a screen reader', () => {
  it('has a title, the client language and the quoted text', async () => {
    vi.stubGlobal('Image', class {});
    const res = await generateQuotePdf(
      {
        quoteNumber: 'BW-2027-0042',
        clientName: 'Acme Events',
        eventDate: '2027-06-12',
        currency: 'USD',
        total: 1250,
      },
      'The Hudson Five',
      { ...DEFAULT_BAND_PRICING },
      'fr',
    );
    vi.unstubAllGlobals();
    const pdf = await bytesOf(res.pdfBlob);
    expect(pdf).toMatch(/\/Lang \(fr\)/);
    expect(pdf).toMatch(/\/Title <FEFF[0-9A-F]+>/);
    expect(pdf).toContain(utf16('Acme Events'));
    expect(pdf).toContain('/StructTreeRoot');
    expect(pdf).toContain(`/ActualText <${utf16('Acme Events')}>`);
  });
});

describe('the invisible text lines up with the drawn text', () => {
  it('uses Helvetica\'s real widths: wide "WWW" and narrow "iii" both keep 100% scale', async () => {
    // Drawn at 40 px in Helvetica: W is 0.944 em, i is 0.222 em.
    const size = 40;
    const runs = [
      { text: 'WWW', x: 100, y: 200, size, width: 3 * 0.944 * size },
      { text: 'iii', x: 100, y: 300, size, width: 3 * 0.222 * size },
    ];
    const pdf = await bytesOf(buildTaggedPdf([JPEG], { text: [runs] }));
    const scales = [...pdf.matchAll(/([\d.]+) Tz/g)].map((m) => Number(m[1]));
    expect(scales).toHaveLength(2);
    for (const z of scales) expect(z).toBeCloseTo(100, 0);
  });
});
