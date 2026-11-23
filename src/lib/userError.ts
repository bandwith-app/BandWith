/**
 * Errors shown to people: never the raw text from Postgres, PostgREST or
 * Storage (English, technical: "new row violates row-level security
 * policy"). Known cases get a translated message, anything else the
 * caller's translated fallback; the raw message goes to the console.
 */
import { t } from './i18n';
import { deletionRefusalMessage } from './deletionRefusal';

/** An error whose message is already written (and translated) for people. */
export class UserError extends Error {
  readonly userFacing = true;
}

const isUserError = (e: unknown): e is UserError => !!e && typeof e === 'object' && (e as { userFacing?: unknown }).userFacing === true;

/** `[known reason]` or the fallback, translated. */
export function userMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (isUserError(error)) return error.message;
  const e = error as { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = String(e.code ?? '');
  const status = Number(e.status ?? e.statusCode ?? 0);
  if (msg) console.warn('[BandWith]', msg);
  // "Could not delete the song" → "Could not delete the song. <reason>"
  fallback = /[.!?…]$/.test(fallback) ? fallback : `${fallback}.`;
  // Paid plans (161): the band's plan has no room; the plan prompt explains the rest.
  if (/BW_PLAN_LIMIT:/.test(msg)) {
    return `${fallback} ${t('Your band’s plan has no room for this.')}`;
  }
  // Song files (197): no retry helps, the file has to be uploaded again.
  if (code === 'BWF02' || /BW_FILE_REMOVED:/.test(msg)) {
    return `${fallback} ${t('This file is no longer available: upload it again.')}`;
  }
  if (code === 'BWF01' || /BW_FILE_IN_USE:/.test(msg)) {
    return `${fallback} ${t('This file belongs to another song: upload it again.')}`;
  }
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|offline/i.test(msg)) {
    return `${fallback} ${t('Check your connection and try again.')}`;
  }
  if (code === '42501' || status === 401 || status === 403 || /row-level security|permission denied|not authori[sz]ed|only band admins/i.test(msg)) {
    return `${fallback} ${t('Only band admins can do this.')}`;
  }
  // An account being deleted holds the band (180).
  const deleting = deletionRefusalMessage(error);
  if (deleting) return `${fallback} ${deleting}`;
  if (status === 413 || /maximum allowed size|payload too large|too large/i.test(msg)) {
    return `${fallback} ${t('This file is too large.')}`;
  }
  if (/mime type|invalid_mime|not supported/i.test(msg)) {
    return `${fallback} ${t('This file type is not supported.')}`;
  }
  return `${fallback} ${t('Try again.')}`;
}

/**
 * A plan refusal (161) in words, else what the screen showed before: for
 * screens that print a service's own message (some are written for people).
 * The plan prompt (PlanLimitSheet) opens on its own and explains the rest.
 */
export function planOr(error: unknown, otherwise: string): string {
  const msg = error && typeof error === 'object' ? (error as { message?: unknown }).message : null;
  if (typeof msg === 'string' && /BW_PLAN_LIMIT:/.test(msg)) return t('Your band’s plan has no room for this.');
  return deletionRefusalMessage(error) ?? otherwise;
}

/** A plan refusal (161) as an error written for people, else null: for services that rewrap errors. */
export function planRefusal(error: unknown): UserError | null {
  const msg = error && typeof error === 'object' ? (error as { message?: unknown }).message : null;
  if (typeof msg === 'string' && /BW_PLAN_LIMIT:/.test(msg)) return new UserError(t('Your band’s plan has no room for this.'));
  // An account being deleted holds the band (180): also written for people.
  const deleting = deletionRefusalMessage(error);
  return deleting ? new UserError(deleting) : null;
}
