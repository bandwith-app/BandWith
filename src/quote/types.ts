// What a client sees of a quote on /quote.html (migration 099).
// The app builds it (src/lib/services/quoteLinks.ts) from the same numbers
// and labels as the PDF, already in the client's language, and publishes
// it with bw_quote_link_publish. Only client-facing data: never the
// musicians, their fees or the band's internal notes.

export interface ClientQuoteItem {
  label: string;
  detail?: string | null;
  /** null = included. */
  amount: number | null;
}

export interface ClientQuoteOption {
  label: string;
  detail?: string | null;
  total: number;
}

export interface ClientQuoteSnapshot {
  v: 1;
  /** Round 4 (183): the same in every language; the server keeps the version when only the language changed. */
  contentKey?: string;
  /**
   * Round 6: who this summary is for (the quote's client when it was built).
   * The server checks it against the quote at publish and never stores it
   * (the page never gets it).
   */
  client?: { name: string; email: string };
  ref: string;
  title: string;
  eventType?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:MM, 24h */
  start?: string | null;
  end?: string | null;
  venue?: string | null;
  city?: string | null;
  guests?: number | null;
  lineup?: string | null;
  sets?: string | null;
  items: ClientQuoteItem[];
  currency: string;
  subtotal: number;
  discount: number;
  discountNote?: string | null;
  net: number;
  vatLabel: string;
  vat: number;
  total: number;
  /** The total as text, for notifications ("€1,200.00"). */
  totalLabel: string;
  /** dueDate (YYYY-MM-DD) when the quote sets one. */
  deposit?: { percent: number; amount: number; dueDate?: string | null } | null;
  /**
   * 168: how to pay the deposit (the band's bank details as on the PDF, its
   * own payment link). bw_quote_link_view sends it only once accepted.
   */
  pay?: ClientQuotePay | null;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
  /** Package options shown side by side in the PDF summary page. */
  options?: ClientQuoteOption[];
}

/** 168: how to pay the deposit, in the client's language. */
export interface ClientQuotePay {
  bank: ClientBalanceBankRow[] | null;
  /** https only (checked by the app; the page checks again). */
  stripeUrl: string | null;
  /** The reference for the bank transfer ("Q-2026-0014 · Deposit"). */
  reference: string;
}

/** One "label: value" row of the band's bank details (the page shows a Copy button). */
export interface ClientBalanceBankRow {
  label: string;
  value: string;
}

/**
 * The final balance (saldo) request, migration 168: published by an admin
 * after the client accepted, shown on the same page. Built by the app in
 * the client's language (src/lib/quoteBalance.ts). Only the ways the band
 * picked: bank details, its own Stripe payment link, a cash note.
 */
export interface ClientBalance {
  v: 1;
  currency: string;
  /** The agreed total. */
  total: number;
  /** Already received: "Deposit received", "Already paid". */
  received: { label: string; amount: number }[];
  /** Of that, the other payments the admin typed (not the deposit), so the next request starts from them. */
  other?: number;
  /** What is still due. */
  amount: number;
  amountLabel: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** The reference for the bank transfer ("Q-2026-0014 · Balance"). */
  reference: string;
  bank: ClientBalanceBankRow[] | null;
  /** https only (checked by the app and by bw_quote_balance_publish). */
  stripeUrl: string | null;
  cash: string | null;
  /** A short note from the band. */
  note: string | null;
  /** The balance PDF (same document, marked as a balance request). */
  pdfUrl?: string | null;
}

export type QuoteLinkStatus = 'draft' | 'sent' | 'viewed' | 'discussing' | 'accepted' | 'declined';

export interface QuoteLinkMessage {
  from: 'client' | 'band';
  body: string;
  at: string;
}

/** bw_quote_link_view / _seen / _respond / _message */
export interface QuoteLinkView {
  status: QuoteLinkStatus;
  lang: string;
  band_name: string;
  client_name: string | null;
  quote: ClientQuoteSnapshot;
  version: number;
  updated_at: string | null;
  pdf_url: string | null;
  accepted_name: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  expired: boolean;
  messages: QuoteLinkMessage[];
  /** 163: the band's plan shows the "Made with BandWith" mark (absent before 163 = no mark). */
  made_with?: boolean;
  /** 168: the balance request (accepted quotes only), absent before 168. */
  balance?: ClientBalance | null;
  /** 168: when the balance was published or last changed. */
  balance_at?: string | null;
  /** 168: the band recorded the balance as received. */
  balance_paid?: boolean;
  balance_paid_at?: string | null;
  /** 168: the band recorded the deposit as received (accepted quotes only). */
  deposit_paid?: boolean;
  /** 183: the amount the band recorded as received (absent before 183 or when not recorded). */
  deposit_paid_amount?: number | null;
  /** 183: its currency (the gig's), when it differs from the quote's it is shown in it. */
  deposit_paid_currency?: string | null;
  /** respond: the quote changed since the client loaded it; nothing was recorded. */
  stale?: boolean;
  /** 187 round 10: the quote's event was cancelled or deleted: no accept (absent before 187). */
  unavailable?: boolean;
}
