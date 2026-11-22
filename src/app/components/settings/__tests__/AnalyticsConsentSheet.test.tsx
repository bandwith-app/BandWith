import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsConsentSheet } from '../AnalyticsConsentSheet';
import { setLocalePref as setLocale } from '@/lib/i18n';

afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('AnalyticsConsentSheet', () => {
  it('asks with two answers of the same weight and says what is never shared', () => {
    const onAnswer = vi.fn();
    render(<AnalyticsConsentSheet open onAnswer={onAnswer} onDismiss={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Help us improve BandWith?' });
    expect(dialog.textContent).toMatch(/Never your songs, gigs, messages or contacts/);
    // The same yes turns on Crashlytics (review #277): the question says so.
    expect(dialog.textContent).toMatch(/crash details/);
    const no = screen.getByRole('button', { name: 'No thanks' });
    const yes = screen.getByRole('button', { name: 'Allow' });
    expect(no.className).toBe(yes.className);
    fireEvent.click(no);
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    fireEvent.click(yes);
    expect(onAnswer).toHaveBeenLastCalledWith(true);
  });

  it('closing without an answer is not a no', () => {
    const onAnswer = vi.fn();
    const onDismiss = vi.fn();
    render(<AnalyticsConsentSheet open onAnswer={onAnswer} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.bg-black\\/60')!);
    expect(onDismiss).toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('speaks Italian', () => {
    setLocale('it');
    render(<AnalyticsConsentSheet open onAnswer={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Vuoi aiutarci a migliorare BandWith?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No, grazie' })).toBeTruthy();
  });
});
