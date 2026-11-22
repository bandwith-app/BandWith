/**
 * Fee shown on a gig invite: only the member's own fee (decided 2026-11-13,
 * members never see the gig total). Null when there is none to show.
 */
export const inviteFeeToShow = (data: Record<string, unknown> | null | undefined): number | null => {
  const fee = Number(data?.member_fee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
};

/**
 * The currency of the band an invite comes from (i18n #9): the inbox lists
 * every band's invites, so the fee is written in the issuing band's
 * currency, not the band selected in the app. The invite's own `currency`
 * first, then that band's pricing currency, then the app's.
 */
export const inviteFeeCurrency = (
  data: Record<string, unknown> | null | undefined,
  bandId: string | null | undefined,
  bands: { id?: string | null; pricing_currency?: string | null }[] | null | undefined,
  fallback: string,
): string => {
  const own = String(data?.currency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(own)) return own;
  const band = bandId ? bands?.find((b) => b?.id === bandId) : undefined;
  const code = String(band?.pricing_currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};
