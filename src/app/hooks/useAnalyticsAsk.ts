import { useCallback, useEffect, useMemo, useState } from 'react';
import { setAnalyticsConsent, shouldAskAnalyticsConsent, useAnalyticsConsent } from '@/lib/appAnalytics';

/**
 * The one-time usage-statistics question (AnalyticsConsentSheet), in two
 * parts because what blocks it (an open sheet, Stage mode: useLayerOpen) is
 * only watched while the question is still due.
 */
export interface AnalyticsAsk {
  /** Still to be asked in this run: not answered, and not closed without an answer. */
  due: boolean;
  /** The sheet has come up (it hides while something blocks it). */
  asking: boolean;
  show: () => void;
  answer: (allow: boolean) => void;
  /** Closed without an answer: over for this run, asked again on the next launch. */
  dismiss: () => void;
}

export function useAnalyticsAsk(): AnalyticsAsk {
  const consent = useAnalyticsConsent();
  const [asking, setAsking] = useState(false);
  // Answered or closed in this run. Kept here, not read back from the stored
  // answer: an older yes given again stores the same answer (only its wording
  // version changes), and a closed sheet stores nothing.
  const [closed, setClosed] = useState(false);
  const due = useMemo(() => !closed && shouldAskAnalyticsConsent(), [consent, closed]);
  const show = useCallback(() => setAsking(true), []);
  const answer = useCallback((allow: boolean) => {
    setAsking(false);
    setClosed(true);
    void setAnalyticsConsent(allow ? 'granted' : 'denied');
  }, []);
  const dismiss = useCallback(() => {
    setAsking(false);
    setClosed(true);
  }, []);
  return { due, asking, show, answer, dismiss };
}

/** Is the sheet open? It comes 1.5 s after nothing blocks it, and hides while something does. */
export function useAnalyticsAskOpen(ask: AnalyticsAsk, blocked: boolean): boolean {
  const { due, show } = ask;
  useEffect(() => {
    if (blocked || !due) return;
    const timer = window.setTimeout(show, 1500);
    return () => window.clearTimeout(timer);
  }, [blocked, due, show]);
  return ask.asking && !blocked;
}
