import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { BandSwitchPrompt } from '../BandSwitchPrompt';
import { setLocalePref } from '@/lib/i18n';
import appSource from '@/app/AuthenticatedApp.tsx?raw';
import promptSource from '../BandSwitchPrompt.tsx?raw';

afterEach(() => { cleanup(); setLocalePref('en'); });

describe('BandSwitchPrompt', () => {
  it('names both bands and switches on confirm', () => {
    const onChoose = vi.fn();
    render(
      <BandSwitchPrompt
        request={{ bandName: 'Mirage', activeBandName: 'Velvet Static', action: 'delete this event' }}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByText(/You’re in Velvet Static right now/)).toBeTruthy();
    fireEvent.click(screen.getByText('Switch to Mirage'));
    expect(onChoose).toHaveBeenCalledWith('switch');
  });

  it('offers "Just view" for items that can be viewed from any band', () => {
    const onChoose = vi.fn();
    render(
      <BandSwitchPrompt request={{ bandName: 'Mirage', action: 'act on it', allowStay: true }} onChoose={onChoose} />,
    );
    fireEvent.click(screen.getByText('Just view'));
    expect(onChoose).toHaveBeenCalledWith('stay');
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('renders nothing without a request', () => {
    render(<BandSwitchPrompt request={null} onChoose={vi.fn()} />);
    expect(screen.queryByText(/Switch to/)).toBeNull();
  });
});

describe('BandSwitchPrompt: every action is a whole translated sentence (Codex #297 M4)', () => {
  it('"restore this date" is not English spliced into another language', () => {
    setLocalePref('it');
    render(<BandSwitchPrompt request={{ bandName: 'Mirage', action: 'restore this date' }} onChoose={vi.fn()} />);
    expect(screen.getByText(/Per ripristinare questa data, passa prima a Mirage\./)).toBeTruthy();
    expect(screen.queryByText(/restore this date/)).toBeNull();
  });

  it('each action the app asks about has its own sentence', () => {
    const actions = new Set<string>();
    for (const m of appSource.matchAll(/(?:inItemBand|askBandFor(?:Ref\.current)?)\([^,]+,\s*"([^"]+)"/g)) actions.add(m[1]);
    expect(actions.has('restore this date')).toBe(true);
    for (const a of actions) expect(promptSource, a).toContain(`case '${a}':`);
  });
});
