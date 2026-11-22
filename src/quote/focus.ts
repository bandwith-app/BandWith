/**
 * Round 4: the client page redraws itself when the band answers or
 * publishes a new version (the 30 s refresh). Whatever the client was typing
 * in keeps its focus, caret and selection: the redraw makes new fields with
 * the same ids, and this moves the focus back into them.
 */
export interface FocusMark {
  id: string;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
}

const textField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio');

export function rememberFocus(doc: Document = document): FocusMark | null {
  const el = doc.activeElement;
  if (!el || el === doc.body || !el.id) return null;
  if (!textField(el)) return { id: el.id, start: null, end: null, direction: null };
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection };
}

export function restoreFocus(mark: FocusMark | null, doc: Document = document): void {
  if (!mark) return;
  const el = doc.getElementById(mark.id);
  if (!el || el === doc.activeElement) return;
  el.focus({ preventScroll: true });
  if (textField(el) && mark.start !== null && mark.end !== null) {
    try {
      el.setSelectionRange(mark.start, mark.end, mark.direction ?? undefined);
    } catch {
      /* a field type without a caret */
    }
  }
}
