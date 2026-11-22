/**
 * The text an admin sees when a quote action fails: translated only, the
 * server's own message goes to the console. Exceptions (183): another
 * admin changed the quote's client or prices while it was open (40001), and
 * the server says so in this admin's language; an accepted quote keeps its
 * client and a quote with payments its currency (round 4: the server's hint
 * names the case, the app says it in its own language).
 */
export const quoteErrorText = (
  err: unknown,
  fallback: string,
  t: (key: string, params?: Record<string, string>) => string,
): string => {
  const e = err as { code?: string; message?: string; hint?: string; details?: string } | null;
  if (e?.hint === 'BW_QUOTE_ACCEPTED') return t('This quote has been accepted: to send it to someone else, duplicate it.');
  if (e?.hint === 'BW_QUOTE_CURRENCY_LOCKED') {
    return t('This quote has payments recorded in {currency}, so its currency can’t be changed.', { currency: e.details || '' });
  }
  if (e?.code === '40001' && e.message) return e.message;
  return `${fallback}. ${t('Check your connection and try again.')}`;
};
