import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { handleBackFromStack } from '@/lib/backStack';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { InputListEditor } from '../InputListEditor';
import type { InputChannel } from '@/lib/stagePlot';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const inputs: InputChannel[] = [{ id: 'c1', source: 'Lead vox', mic: 'Beta 58', kind: 'mic', who: 'Leo' }];
const lineup: InputChannel[] = [
  { id: 'l1', source: 'Kick', mic: 'Beta 91', kind: 'mic', who: 'Marta' },
  { id: 'l2', source: 'Bass', mic: 'DI', kind: 'di', who: 'Jonah' },
];

const renderEditor = (onCancel = vi.fn(), onSave = vi.fn().mockResolvedValue(true)) => {
  render(<InputListEditor eventTitle="Rooftop" inputs={inputs} people={['Leo']} fromLineup={() => lineup} onCancel={onCancel} onSave={onSave} />);
  return { onCancel, onSave };
};

describe('Input list editor', () => {
  it('input list editor asks before discarding changes (Cancel)', async () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /BUILD FROM LINEUP/ }));
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('input list editor asks before discarding changes (Android Back), and Save changes saves', async () => {
    const { onCancel, onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /BUILD FROM LINEUP/ }));
    act(() => {
      handleBackFromStack();
    });
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].map((c: InputChannel) => c.source)).toEqual(['Kick', 'Bass']);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('input list editor without changes closes at once', () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Save your changes?')).toBeNull();
  });
});
