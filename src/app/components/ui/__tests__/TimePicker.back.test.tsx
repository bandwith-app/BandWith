import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { handleBackFromStack, useSystemBack } from '@/lib/backStack';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { TimePicker } from '../TimePicker';

afterEach(() => cleanup());

/** A sheet that handles Android Back itself, with a time field inside. */
const SheetWithTime: React.FC<{ onSheetBack: () => void }> = ({ onSheetBack }) => {
  useSystemBack(true, () => {
    onSheetBack();
    return true;
  });
  return <TimePicker id="start" value="19:30" onChange={vi.fn()} />;
};

describe('Time picker inside a sheet', () => {
  it('Android Back closes only the time picker, not the sheet it was opened from', async () => {
    const onSheetBack = vi.fn();
    render(<SheetWithTime onSheetBack={onSheetBack} />);
    fireEvent.click(screen.getByRole('button', { name: /19:30/ }));
    await screen.findByRole('dialog');
    act(() => {
      handleBackFromStack();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSheetBack).not.toHaveBeenCalled();
    // The next Back reaches the sheet.
    act(() => {
      handleBackFromStack();
    });
    expect(onSheetBack).toHaveBeenCalledTimes(1);
  });
});
