// Where replies to a BandWith email go. Emails are sent from
// noreply@bandwith.fun; replies go to a person instead: the one who sent the
// email (quotes: the band admin) or the EMAIL_REPLY_TO inbox (ciao@bandwith.fun).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function replyTo(opts: { configured?: string | null; person?: string | null }): { reply_to?: string } {
  for (const candidate of [opts.person, opts.configured]) {
    const address = String(candidate ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(address)) return { reply_to: address };
  }
  return {};
}
