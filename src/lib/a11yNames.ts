import type { TranslateVars } from '@/lib/i18n';

type T = (source: string, vars?: TranslateVars) => string;

/** What a count badge shows: 1…99, then 99+. */
export const badgeText = (count: number): string => (count > 99 ? '99+' : String(count));

/**
 * The name of a button that shows a count badge. The count is written as the
 * badge shows it, outside brackets: WCAG 2.5.3 (axe label-content-name-mismatch)
 * wants the visible text inside the name, and axe drops what is in brackets.
 */
export const unreadName = (t: T, name: string, count: number | undefined): string =>
  count && count > 0 ? t('{name}, {count} unread', { name, count: badgeText(count) }) : name;

/**
 * The name of a button whose face shows text that is not its label (the
 * profile button's initials): the visible text first, then what it does.
 */
export const withVisibleText = (visible: string | null | undefined, name: string): string =>
  visible?.trim() ? `${visible.trim()}, ${name}` : name;
