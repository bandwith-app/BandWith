/**
 * The brand page beside the onboarding (open iPhone Duo, iPad, a computer):
 * its named steps and the wizard header's "STEP 2 OF 6" are the same count,
 * and nobody is told to set up a band before choosing one.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DuoAuthBrand } from '../DuoAuthLayout';
import { StepIndicator } from '../OnboardingChrome';
import { brandPlan, wizardStep, type FlowScreen } from '../onboardingSteps';
import { setLocalePref, t } from '@/lib/i18n';

/** The brand page's rows: number ("3", "3–6", "" for the finish), name, and whether it is the lit one. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll('ol > li')].map((li) => {
    const [, number = '', name = ''] = (li.textContent ?? '').match(/^\s*(\d+(?:–\d+)?)?\s*(.*)$/) ?? [];
    return { number, name, current: li.getAttribute('aria-current') === 'step' };
  });
}
const headline = (container: HTMLElement) => container.querySelector('.bw-display-lg')?.textContent ?? '';
const lastNumber = (number: string) => Number(number.split('–').pop());
/** The headline and the list (not the BANDWITH wordmark above them). */
const said = (container: HTMLElement) => `${headline(container)} ${container.querySelector('ol')?.textContent ?? ''}`;

beforeEach(() => setLocalePref('en'));

describe('The brand page’s steps', () => {
  const walks: Record<'creator' | 'solo', FlowScreen[]> = {
    creator: ['account', 'intent', 'band', 'profile', 'invite', 'songs', 'done'],
    solo: ['account', 'profile', 'done'],
  };

  for (const path of ['creator', 'solo'] as const) {
    it(`${path}: the lit row and the last number match the header on every step`, () => {
      for (const screen of walks[path]) {
        const { container, unmount } = render(<DuoAuthBrand plan={brandPlan(path, screen)} />);
        const list = rows(container);
        const numbered = list.filter((row) => row.number);
        const lit = list.filter((row) => row.current);
        expect(lit).toHaveLength(1);
        if (screen === 'done') {
          // The finish has no number: it is not a step.
          expect(lit[0]).toMatchObject({ number: '', name: 'Ready to rock' });
        } else {
          const header = wizardStep(path, screen);
          const [from, to = from] = lit[0].number.split('–').map(Number);
          expect(from).toBeLessThanOrEqual(header.step);
          expect(to).toBeGreaterThanOrEqual(header.step);
          expect(lastNumber(numbered[numbered.length - 1].number)).toBe(header.total);
        }
        // "Ready to rock" closes the list, without a number.
        expect(list[list.length - 1]).toMatchObject({ number: '', name: 'Ready to rock' });
        unmount();
      }
    });
  }

  it('before the path is chosen: "Set up your account.", and no band step by name', () => {
    for (const screen of ['account', 'intent'] as const) {
      const { container, unmount } = render(<DuoAuthBrand plan={brandPlan('creator', screen)} />);
      expect(headline(container)).toBe('Set upyour account.');
      expect(rows(container).map((row) => `${row.number} ${row.name}`.trim())).toEqual([
        '1 Create account',
        '2 Choose your path',
        '3–6 Your setup',
        'Ready to rock',
      ]);
      expect(said(container)).not.toMatch(/band/i);
      unmount();
    }
  });

  it('the band path names its six steps under "Set up your band."', () => {
    const { container } = render(<DuoAuthBrand plan={brandPlan('creator', 'invite')} />);
    expect(headline(container)).toBe('Set upyour band.');
    expect(rows(container).map((row) => `${row.number} ${row.name}`.trim())).toEqual([
      '1 Create account',
      '2 Choose your path',
      '3 Name your band',
      '4 About you',
      '5 Invite bandmates',
      '6 Build your repertoire',
      'Ready to rock',
    ]);
  });

  it('the solo path: three steps, and no band anywhere', () => {
    const { container } = render(<DuoAuthBrand plan={brandPlan('solo', 'profile')} />);
    expect(headline(container)).toBe('Set upyour schedule.');
    expect(rows(container).map((row) => `${row.number} ${row.name}`.trim())).toEqual([
      '1 Create account',
      '2 Choose your path',
      '3 About you',
      'Ready to rock',
    ]);
    expect(said(container)).not.toMatch(/band/i);
  });

  it('the names line up whatever the widest number is', () => {
    const { container } = render(<DuoAuthBrand plan={brandPlan('creator', 'account')} />);
    const starts = [...container.querySelectorAll('ol > li')].map((li) => {
      const text = li.textContent ?? '';
      return text.length - text.replace(/^[\d–\s]+/, '').length;
    });
    expect(new Set(starts).size).toBe(1);
  });

  it('is translated', () => {
    setLocalePref('it');
    const { container } = render(<DuoAuthBrand plan={brandPlan('creator', 'account')} />);
    expect(container.textContent).toContain(t('Your setup'));
    expect(t('Your setup')).not.toBe('Your setup');
    expect(headline(container)).toBe(`${t('Set up')}${t('your account.')}`);
  });

  it('without a plan (sign in, joining) it is the plain brand page', () => {
    const { container } = render(<DuoAuthBrand />);
    expect(headline(container)).toBe('Run theband.');
    expect(container.querySelector('ol')).toBeNull();
  });
});

describe('The wizard header’s pills', () => {
  it('draw one pill per step of the path', () => {
    for (const path of ['creator', 'solo', 'joiner'] as const) {
      const { step, total } = wizardStep(path, 'profile');
      const { container, unmount } = render(<StepIndicator step={step} total={total} />);
      expect(container.querySelectorAll('span')).toHaveLength(total);
      unmount();
    }
  });
});
