import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LyricsText } from '../LyricsViewer';
import { SongBody } from '../SongViews';
import { MyVoicePartProvider, VOICE_DIM_HINT_KEY, VOICE_HIGHLIGHT_KEY } from '../VoiceParts';

// Made-up song (no real lyrics).
const LYRICS = [
  '# Chorus',
  '[C]Paper boats on the [G]river',
  '{bv}(ooh, [Am]yeah){/bv}',
  '{v2}Hudson lights{/v2}',
  '{all}All the way home{/all}',
  '{sp}Count it, Brooklyn{/sp}',
  'Lead and {bv}echo{/bv}',
].join('\n');

afterEach(() => {
  cleanup();
  localStorage.removeItem(VOICE_HIGHLIGHT_KEY);
  localStorage.removeItem(VOICE_DIM_HINT_KEY);
});

describe('voice parts in the lyrics', () => {
  it('draws each part with its own shape, never the markers', () => {
    const { container } = render(<LyricsText lyrics={LYRICS} size={20} />);
    expect(container.textContent).not.toMatch(/\{\/?(bv|v2|all|sp)\}/);
    const part = (v: string) => [...container.querySelectorAll(`[data-voice="${v}"]`)].filter((el) => !el.closest('[data-voice-legend]'));
    expect(part('bv')).toHaveLength(2);
    expect(part('bv')[0]).toHaveClass('bw-voice-bv');
    expect(part('bv')[0].tagName).toBe('P');
    // Inside a line: just those words.
    expect(part('bv')[1].tagName).toBe('SPAN');
    expect(part('bv')[1]).toHaveTextContent('echo');
    expect(part('v2')[0]).toHaveClass('bw-voice-v2');
    expect(part('all')[0]).toHaveClass('bw-voice-all');
    expect(part('sp')[0]).toHaveClass('bw-voice-sp');
    // Chords inside a part stay chords.
    expect(part('bv')[0]).toHaveTextContent('Am');
    expect(part('bv')[0].textContent).toMatch(/\(ooh, Am?yeah\)/);
  });

  it('keeps the parts in the lyrics-only view', () => {
    const { container } = render(<SongBody song={{ lyrics: LYRICS }} view="lyrics" size={20} />);
    const bv = container.querySelector('p[data-voice="bv"]')!;
    expect(bv).toHaveTextContent('(ooh, yeah)');
    expect(bv).not.toHaveTextContent('Am');
  });

  it('shows a legend only when the song uses parts', () => {
    const { rerender } = render(<LyricsText lyrics={LYRICS} size={20} />);
    const legend = screen.getByRole('group', { name: 'Voice parts' });
    expect(legend).toHaveTextContent('Lead');
    expect(legend).toHaveTextContent('2nd voice');
    expect(legend).toHaveTextContent('Backing');
    expect(legend).toHaveTextContent('All');
    expect(legend).toHaveTextContent('Spoken');
    rerender(<LyricsText lyrics={'# Verse\n[C]Paper boats'} size={20} />);
    expect(screen.queryByRole('group', { name: 'Voice parts' })).toBeNull();
  });

  it('highlights my part: the others dim, everyone’s lines stay bright', () => {
    const { container } = render(
      <MyVoicePartProvider value="bv">
        <LyricsText lyrics={LYRICS} size={20} />
      </MyVoicePartProvider>,
    );
    const dim = () => [...container.querySelectorAll('[data-voice-dim="true"]')].map((el) => el.textContent);
    const dimmed = dim().join('|');
    for (const t of ['Paper boats on the', 'Hudson lights', 'Count it, Brooklyn', 'Lead and']) expect(dimmed).toContain(t);
    for (const t of ['All the way home', 'ooh', 'echo']) expect(dimmed).not.toContain(t);
    const toggle = screen.getByRole('button', { name: 'Highlight my part' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(dim()).toEqual([]);
    expect(localStorage.getItem(VOICE_HIGHLIGHT_KEY)).toBe('off');
  });

  it('offers no highlight to members who don’t sing', () => {
    const { container } = render(
      <MyVoicePartProvider value={null}>
        <LyricsText lyrics={LYRICS} size={20} />
      </MyVoicePartProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Highlight my part' })).toBeNull();
    expect(container.querySelectorAll('[data-voice-dim="true"]')).toHaveLength(0);
  });

  it('marks my part in the legend and says once why lines are dimmed', () => {
    const { unmount } = render(
      <MyVoicePartProvider value="bv">
        <LyricsText lyrics={LYRICS} size={20} />
      </MyVoicePartProvider>,
    );
    const legend = screen.getByRole('group', { name: 'Voice parts' });
    expect(legend.querySelector('[data-voice="bv"]')!.parentElement).toHaveTextContent(/Backing\s*· you/);
    expect(legend.querySelector('[data-voice="v2"]')!.parentElement).not.toHaveTextContent('you');
    const hint = screen.getByRole('note');
    expect(hint).toHaveTextContent('Lines you don’t sing are dimmed.');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    unmount();
    // Seen once: not again on this device.
    render(
      <MyVoicePartProvider value="bv">
        <LyricsText lyrics={LYRICS} size={20} />
      </MyVoicePartProvider>,
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('the hint goes away when the singer turns the highlight off, and never shows when nothing is dimmed', () => {
    render(
      <MyVoicePartProvider value="bv">
        <LyricsText lyrics={LYRICS} size={20} />
      </MyVoicePartProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Highlight my part' }));
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    localStorage.removeItem(VOICE_DIM_HINT_KEY);
    localStorage.removeItem(VOICE_HIGHLIGHT_KEY);
    render(
      <MyVoicePartProvider value={['lead', 'bv']}>
        <LyricsText lyrics={'# Chorus\nPaper boats\n{bv}(ooh){/bv}'} size={20} />
      </MyVoicePartProvider>,
    );
    expect(screen.queryByRole('note')).toBeNull();
  });
});
