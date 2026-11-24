import type { OnboardingPath } from '@/lib/OnboardingContext';

/* ─────────────────────────────────────────────────────────────────────────
 * The onboarding's steps, in one place. The wizard header ("STEP 2 OF 6"),
 * the brand page's named list and the completion screen's pills all count
 * from these lists, so they cannot disagree.
 * ───────────────────────────────────────────────────────────────────────── */

/** A screen that counts as a step (the last screen, "Ready to rock", is the finish, not a step). */
export type WizardScreen = 'account' | 'intent' | 'band' | 'profile' | 'invite' | 'songs';

/** What the flow shows: a step, or the finish. */
export type FlowScreen = WizardScreen | 'done';

/** The steps of each path, in order. */
export const WIZARD_ORDER: Record<OnboardingPath, readonly WizardScreen[]> = {
  creator: ['account', 'intent', 'band', 'profile', 'invite', 'songs'],
  solo: ['account', 'intent', 'profile'],
  joiner: ['account', 'profile'],
};

const orderOf = (path: OnboardingPath | null | undefined) => WIZARD_ORDER[path ?? 'creator'];

/** How many steps a path has. */
export function wizardTotal(path: OnboardingPath | null | undefined): number {
  return orderOf(path).length;
}

/** Step number and total for a screen, depending on the onboarding path. */
export function wizardStep(path: OnboardingPath | null | undefined, screen: WizardScreen): { step: number; total: number } {
  const order = orderOf(path);
  const i = order.indexOf(screen);
  return { step: i < 0 ? 1 : i + 1, total: order.length };
}

/**
 * The screen OnboardingFlow shows on the creator and solo paths (the same
 * rules as its routing: signed out → the account form; then by step).
 */
export function flowScreen(path: 'creator' | 'solo', isAuthenticated: boolean, currentStep: number): FlowScreen {
  if (!isAuthenticated) return 'account';
  if (path === 'solo') return currentStep <= 1 ? 'profile' : 'done';
  if (currentStep <= 1) return 'intent';
  return (['band', 'profile', 'invite', 'songs'] as const)[currentStep - 2] ?? 'done';
}

export type BrandRowState = 'done' | 'current' | 'upcoming';

export interface BrandRow {
  /**
   * A step of the path, or `rest`: every step after "Choose your path" while
   * the path isn't chosen yet (they depend on the choice, so none is named).
   */
  id: WizardScreen | 'rest';
  /** Step numbers the row stands for (`from === to` for a single step). */
  from: number;
  to: number;
  state: BrandRowState;
}

export interface BrandPlan {
  /** What the headline is about: the account until the path is chosen, then the band or the solo calendar. */
  subject: 'account' | 'band' | 'solo';
  /** The numbered rows; the last row's `to` is the header's total. */
  rows: BrandRow[];
  /** The step the header shows ("STEP {step} OF {total}"); on the finish, `total + 1`. */
  step: number;
  total: number;
  /** "Ready to rock": where the list ends. Not a step, so it has no number. */
  finish: BrandRowState;
}

/**
 * The brand page's list for the screen shown.
 *
 * Everyone starts on the band path's count (the header says "OF 6"), but
 * until "What brings you here?" is answered the list names only the two steps
 * that are certain and sums up the rest ("3–6"): a solo musician is not told
 * to name a band they don't have.
 */
export function brandPlan(path: 'creator' | 'solo', screen: FlowScreen): BrandPlan {
  const order = WIZARD_ORDER[path];
  const total = order.length;
  const index = screen === 'done' ? total : Math.max(0, order.indexOf(screen));
  const step = index + 1;
  const stateOf = (from: number, to: number): BrandRowState => (step > to ? 'done' : step >= from ? 'current' : 'upcoming');
  const undecided = path === 'creator' && (screen === 'account' || screen === 'intent');
  const choice = order.indexOf('intent') + 1;

  const rows: BrandRow[] = [];
  order.forEach((id, i) => {
    const n = i + 1;
    if (undecided && n > choice) return;
    rows.push({ id, from: n, to: n, state: stateOf(n, n) });
  });
  if (undecided && total > choice) rows.push({ id: 'rest', from: choice + 1, to: total, state: stateOf(choice + 1, total) });

  return {
    subject: undecided ? 'account' : path === 'solo' ? 'solo' : 'band',
    rows,
    step,
    total,
    finish: screen === 'done' ? 'current' : 'upcoming',
  };
}

/** "3" for a single step, "3–6" for a run of them. */
export function brandRowNumber(row: Pick<BrandRow, 'from' | 'to'>): string {
  return row.from === row.to ? String(row.from) : `${row.from}–${row.to}`;
}
