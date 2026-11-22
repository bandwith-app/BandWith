/**
 * The PDF writer behind quotes and setlists. Pages are drawn on a canvas and
 * stored as one JPEG each (no PDF library, works offline), so on its own a
 * page is only a picture: a screen reader with OCR off reads nothing.
 *
 * The text drawn on each canvas is recorded (recordCanvasText) and written
 * as a tagged PDF: invisible text (render mode 3) over the picture, one
 * paragraph per line in drawing order, each with its exact Unicode as
 * ActualText; the picture itself is an artifact. The document also gets a
 * title (shown instead of the file name) and its language.
 */

/** One fillText call, in canvas pixels; `y` is the baseline. */
export interface PdfTextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

export interface PdfDocInfo {
  /** Document title (viewers show it instead of the file name). */
  title?: string;
  /** Language of the text, e.g. "en", "it". */
  lang?: string;
  /** The text of each page, in reading order (recordCanvasText). */
  text?: PdfTextRun[][];
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
/** Canvas size of every page (A4 at 200 DPI). */
const PAGE_W_PX = 1654;
const PAGE_H_PX = 2339;

/**
 * Records the text drawn on `ctx` from now on (position, size, width), in
 * drawing order, which is the pages' reading order.
 */
export function recordCanvasText(ctx: CanvasRenderingContext2D): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  const fill = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    if (maxWidth === undefined) fill(text, x, y);
    else fill(text, x, y, maxWidth);
    const s = String(text ?? '');
    if (!s.trim() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(ctx.font))?.[1]) || 16;
    let width = 0;
    try {
      width = Number(ctx.measureText(s).width) || 0;
    } catch {
      /* no metrics: the run keeps width 0 */
    }
    if (maxWidth !== undefined && Number.isFinite(maxWidth)) width = Math.min(width, maxWidth);
    const align = ctx.textAlign;
    const left = align === 'right' || align === 'end' ? x - width : align === 'center' ? x - width / 2 : x;
    const base = ctx.textBaseline;
    const baseline =
      base === 'top' || base === 'hanging'
        ? y + size * 0.8
        : base === 'middle'
          ? y + size * 0.35
          : base === 'bottom' || base === 'ideographic'
            ? y - size * 0.2
            : y;
    runs.push({ text: s, x: left, y: baseline, size, width });
  };
  return runs;
}

/** Unicode → WinAnsi (the standard Helvetica's encoding); others become "?". */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const winAnsiCodes = (s: string): number[] =>
  Array.from(s, (ch) => {
    const c = ch.codePointAt(0) ?? 0x3f;
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : WIN_ANSI_EXTRA[c] ?? 0x3f;
  });
const winAnsiHex = (s: string): string =>
  winAnsiCodes(s)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');

/** Helvetica advance widths (1/1000 em) for WinAnsi codes 32–255, from its AFM. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
/** Width of `s` set in Helvetica at `size`, as the PDF viewer lays it out. */
export const helveticaWidth = (s: string, size: number): number =>
  (winAnsiCodes(s).reduce((sum, c) => sum + (HELVETICA_WIDTHS[c - 32] ?? 556), 0) / 1000) * size;

/** A PDF text string as UTF-16BE hex with its byte-order mark. */
export const pdfUtf16 = (s: string): string =>
  '<FEFF' +
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('') +
  '>';

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** Runs on one line (same baseline, drawn one after the other) form one paragraph. */
const linesOf = (runs: PdfTextRun[]): PdfTextRun[][] => {
  const lines: PdfTextRun[][] = [];
  for (const r of runs) {
    const line = lines[lines.length - 1];
    const prev = line?.[line.length - 1];
    if (prev && Math.abs(prev.y - r.y) < Math.max(prev.size, r.size) * 0.5) line.push(r);
    else lines.push([r]);
  }
  return lines;
};

/**
 * Packs JPEG pages (data URLs, A4 at 200 DPI) into a multi-page PDF Blob,
 * tagged with the text of each page when `info.text` is given.
 */
export function buildTaggedPdf(jpegDataUrls: string[], info: PdfDocInfo = {}): Blob {
  const pageImages = jpegDataUrls.map((dataUrl) => {
    const binary = atob(dataUrl.split(',')[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });
  const sx = A4_WIDTH_PT / PAGE_W_PX;
  const sy = A4_HEIGHT_PT / PAGE_H_PX;

  // Object ids: fixed ones first, then 3 per page, then one per paragraph.
  const CATALOG = 1;
  const PAGES = 2;
  const INFO = 3;
  const FONT = 4;
  const STRUCT_ROOT = 5;
  const DOCUMENT = 6;
  const PARENT_TREE = 7;
  const pageId = (i: number) => 8 + i * 3;
  let nextId = 8 + pageImages.length * 3;

  const objects = new Map<number, (string | Uint8Array)[]>();
  const paragraphIds: number[] = [];
  const parentTree: string[] = [];

  pageImages.forEach((imgBytes, i) => {
    const page = pageId(i);
    const content = page + 1;
    const image = page + 2;
    const imgName = `/Im${i + 1}`;

    // The picture is decoration for assistive technology: the text below says it.
    let stream = `/Artifact BMC\nq\n${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm\n${imgName} Do\nQ\nEMC\n`;
    const mcidOwners: number[] = [];
    let mcid = 0;
    for (const line of linesOf(info.text?.[i] ?? [])) {
      const para = nextId++;
      const kids: number[] = [];
      for (const r of line) {
        const size = Math.max(1, r.size * sy);
        // Stretch the invisible text to the drawn width (selection, highlights).
        const natural = helveticaWidth(r.text, size);
        const scale = r.width > 0 && natural > 0 ? Math.min(300, Math.max(30, ((r.width * sx) / natural) * 100)) : 100;
        stream +=
          `/Span << /MCID ${mcid} /ActualText ${pdfUtf16(r.text)} >> BDC\n` +
          `BT\n3 Tr\n/F1 ${num(size)} Tf\n${num(scale)} Tz\n1 0 0 1 ${num(r.x * sx)} ${num(A4_HEIGHT_PT - r.y * sy)} Tm\n<${winAnsiHex(r.text)}> Tj\nET\nEMC\n`;
        kids.push(mcid);
        mcidOwners.push(para);
        mcid++;
      }
      const actual = line.map((r) => r.text).join(' ');
      objects.set(para, [
        `<< /Type /StructElem /S /P /P ${DOCUMENT} 0 R /Pg ${page} 0 R /K [${kids.join(' ')}] /ActualText ${pdfUtf16(actual)} >>`,
      ]);
      paragraphIds.push(para);
    }
    parentTree.push(`${i} [${mcidOwners.map((id) => `${id} 0 R`).join(' ')}]`);

    objects.set(page, [
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
        `/Resources << /XObject << ${imgName} ${image} 0 R >> /Font << /F1 ${FONT} 0 R >> >> ` +
        `/Contents ${content} 0 R /StructParents ${i} /Tabs /S >>`,
    ]);
    objects.set(content, [`<< /Length ${stream.length} >>\nstream\n${stream}endstream`]);
    objects.set(image, [
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_W_PX} /Height ${PAGE_H_PX} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.byteLength} >>\nstream\n`,
      imgBytes,
      '\nendstream',
    ]);
  });

  const lang = (info.lang || '').replace(/[^A-Za-z-]/g, '').slice(0, 35);
  objects.set(CATALOG, [
    `<< /Type /Catalog /Pages ${PAGES} 0 R /StructTreeRoot ${STRUCT_ROOT} 0 R /MarkInfo << /Marked true >>` +
      (lang ? ` /Lang (${lang})` : '') +
      ' /ViewerPreferences << /DisplayDocTitle true >> >>',
  ]);
  objects.set(PAGES, [
    `<< /Type /Pages /Kids [${pageImages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pageImages.length} >>`,
  ]);
  objects.set(INFO, [
    `<< ${info.title ? `/Title ${pdfUtf16(info.title)} ` : ''}/Creator (BandWith) /Producer (BandWith) >>`,
  ]);
  objects.set(FONT, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
  objects.set(STRUCT_ROOT, [
    `<< /Type /StructTreeRoot /K ${DOCUMENT} 0 R /ParentTree ${PARENT_TREE} 0 R /ParentTreeNextKey ${pageImages.length} >>`,
  ]);
  objects.set(DOCUMENT, [
    `<< /Type /StructElem /S /Document /P ${STRUCT_ROOT} 0 R /K [${paragraphIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  ]);
  objects.set(PARENT_TREE, [`<< /Nums [${parentTree.join(' ')}] >>`]);

  // Serialise: header, objects by id, cross-reference table, trailer.
  const chunks: Uint8Array[] = [];
  let length = 0;
  const latin1 = (s: string) => {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  };
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? latin1(part) : part;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  push('%PDF-1.7\n%\xFF\xFF\xFF\xFF\n');
  const total = nextId - 1;
  const offsets: number[] = [];
  for (let id = 1; id <= total; id++) {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const part of objects.get(id) ?? ['null']) push(part);
    push('\nendobj\n');
  }
  const xref = length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
