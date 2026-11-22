/**
 * The text an admin sees when a quote action fails: translated only, the
 * server's own message goes to the console. One exception (183): another
 * admin changed the quote's client or prices while it was open (40001), and
 * the server says so in this admin's language.
 */
export const quoteErrorText = (err: unknown, fallback: string, t: (key: string) => string): string => {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === '40001' && e.message) return e.message;
  return `${fallback}. ${t('Check your connection and try again.')}`;
};
