import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { anyLayerOpen, useLayerOpen } from '../useLayerOpen';

afterEach(() => {
  document.body.innerHTML = '';
});

const addDialog = (attrs: Record<string, string> = {}) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

describe('is a sheet, modal or Stage open?', () => {
  it('no dialog: nothing open', () => {
    document.body.innerHTML = '<main><p>Home</p><div role="alert">Urgent</div></main>';
    expect(anyLayerOpen()).toBe(false);
  });

  it('a dialog or alert dialog counts; a hidden one does not', () => {
    const d = addDialog();
    expect(anyLayerOpen()).toBe(true);
    d.hidden = true;
    expect(anyLayerOpen()).toBe(false);
    const a = document.createElement('div');
    a.setAttribute('role', 'alertdialog');
    document.body.appendChild(a);
    expect(anyLayerOpen()).toBe(true);
  });

  it('full-screen editors without a dialog role count too (gig editor, quote wizard: data-modal-open; aria-modal)', () => {
    const editor = document.createElement('div');
    editor.setAttribute('data-modal-open', 'true');
    document.body.appendChild(editor);
    expect(anyLayerOpen()).toBe(true);
    editor.remove();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    expect(anyLayerOpen()).toBe(true);
    modal.setAttribute('aria-modal', 'false');
    expect(anyLayerOpen()).toBe(false);
  });

  it('follows an editor opening and closing', async () => {
    const { result } = renderHook(() => useLayerOpen());
    const editor = document.createElement('div');
    act(() => {
      document.body.appendChild(editor);
    });
    act(() => editor.setAttribute('data-modal-open', 'true'));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => editor.setAttribute('data-modal-open', 'false'));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('follows sheets opening and closing', async () => {
    const { result } = renderHook(() => useLayerOpen());
    expect(result.current).toBe(false);
    let d: HTMLElement;
    act(() => {
      d = addDialog({ 'aria-modal': 'true' });
    });
    await waitFor(() => expect(result.current).toBe(true));
    act(() => d.remove());
    await waitFor(() => expect(result.current).toBe(false));
  });
  it('watching starts with a sheet already open: the very first answer is "open" (no flash of the pop-up over it)', () => {
    const seen: boolean[] = [];
    const { rerender } = renderHook(({ watch }) => {
      const open = useLayerOpen(watch);
      seen.push(open);
      return open;
    }, { initialProps: { watch: false } });
    // A sheet opens while nothing waits (nobody watches)…
    act(() => {
      addDialog();
    });
    // …then an urgent item arrives: every render from now on says "open".
    const from = seen.length;
    rerender({ watch: true });
    expect(seen.slice(from).length).toBeGreaterThan(0);
    expect(seen.slice(from)).not.toContain(false);
  });
});
