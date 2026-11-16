import type { ControlInfo } from './dom';

/**
 * What the crawler must never click, and how it reads a screen.
 *
 * The crawl runs in English (labels below are the English source strings).
 * Anything destructive or outward is recorded as "terminal: <kind>" and left
 * alone. On top of this list, the init script swallows window.open, the
 * share sheet and printing, so a control that slips through still never
 * leaves the app (it is recorded as terminal after the fact).
 */

export type TerminalKind =
  | 'delete'
  | 'leave'
  | 'sign-out'
  | 'send'
  | 'share'
  | 'external'
  | 'tel'
  | 'mailto'
  | 'sms'
  | 'download'
  | 'file-picker'
  | 'submit';

const RULES: [RegExp, TerminalKind][] = [
  [/\b(delete|remove|erase|destroy|revoke|unlink|rotate link|turn off link|reset)\b/i, 'delete'],
  [/\bleave( the)?( band)?\b/i, 'leave'],
  [/\b(sign ?out|log ?out)\b/i, 'sign-out'],
  [/\b(send|resend|notify|remind|nudge|publish|post)\b/i, 'send'],
  [/\b(share|export|download|print|pdf)\b/i, 'share'],
  [/\b(whatsapp|telegram|google|apple|maps?|directions|open in|website|app store|play store|testflight)\b/i, 'external'],
  [/^(call|email|e-mail|text|message on)\b/i, 'external'],
  [/\b(i accept|accept (the )?quote|decline (the )?quote)\b/i, 'submit'],
];

export function terminalKind(c: ControlInfo, origin: string): TerminalKind | null {
  const href = c.href ?? '';
  if (/^tel:/i.test(href)) return 'tel';
  if (/^mailto:/i.test(href)) return 'mailto';
  if (/^sms:/i.test(href)) return 'sms';
  if (c.inputType === 'file') return 'file-picker';
  if (c.download) return 'download';
  if (c.tag === 'a' && href && !href.startsWith('#')) {
    try {
      const u = new URL(href, origin);
      if (u.origin !== new URL(origin).origin || c.target === '_blank') return 'external';
    } catch {
      return 'external';
    }
  }
  const toggle = /^(checkbox|switch|radio)$/.test(c.role);
  for (const [re, kind] of RULES) if (re.test(c.name) && !(toggle && kind === 'submit')) return kind;
  return null;
}

/** A visible Back / Close control of a layer. */
export const BACK_RE = /^(back|go back|close|close .+|cancel|done|dismiss|✕|×|x|keep editing|not now|back to .+)$/i;
export const isBackControl = (c: ControlInfo) => BACK_RE.test(c.name.trim());

/**
 * Privacy (plan 11-13): a member (or a deputy) sees only their own fee and
 * the logistics. Never a client, the client's contacts, a gig price, a quote
 * total or the other musicians' fees. Strings from the demo seed
 * (src/lib/demo/seed.ts): Leo is paid €300, everyone else €250.
 */
export const PRIVATE_WORDS: { word: string; what: string }[] = [
  { word: 'Aurora Events', what: 'client name' },
  { word: 'Northwind', what: 'client name' },
  { word: 'Client B', what: 'client name' },
  { word: 'events@aurora.example', what: 'client e-mail' },
  { word: 'client.a@example.com', what: 'client e-mail' },
  { word: 'client.b@example.com', what: 'client e-mail' },
  { word: 'ops@northwind.example', what: 'client e-mail' },
  { word: 'events@villanecchi.example', what: 'venue contact e-mail' },
  { word: '€1,800', what: 'gig price' },
  { word: '€1.8k', what: 'gig price' },
  { word: '€3,200', what: 'gig price' },
  { word: '€3.2k', what: 'gig price' },
  { word: '€4,500', what: 'gig price' },
  { word: '€4.5k', what: 'gig price' },
  { word: '€1,600', what: 'quote total' },
  { word: '€3,800', what: 'quote total' },
  { word: 'Q-2026-00', what: 'quote number' },
  { word: '€250', what: "another musician's fee" },
  { word: '€1,300', what: 'band payouts' },
  { word: '€1.3k', what: 'band payouts' },
  { word: 'Revenue', what: 'band revenue' },
];

export function privacyLeaks(fullText: string): string[] {
  const t = fullText.toLowerCase();
  return PRIVATE_WORDS.filter((w) => t.includes(w.word.toLowerCase())).map((w) => `${w.what}: "${w.word}"`);
}
