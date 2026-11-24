import React from 'react';
import { BrandMark } from '@/app/components/bw/BrandMark';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { brandRowNumber, type BrandPlan, type BrandRow, type BrandRowState } from './onboardingSteps';
import './onboarding-desktop.css';

/* ─────────────────────────────────────────────────────────────────────────
 * iPhone Duo, open (Figma "Duo · 01 Auth & Onboarding"): a BRAND page on the
 * leading page and the form on the trailing page. During onboarding the
 * brand page names every step, so you always know how far you are; done
 * steps stay visible. The list is built from the same step lists the wizard
 * header counts from (onboardingSteps.ts).
 *
 * A tablet-sized window driven by a mouse (the web app on a computer) gets
 * the same two pages with a desktop layout: onboarding-desktop.css.
 *
 * The brand page only shows on the open display (`data-bw-two-pane`, see
 * src/styles/duo-panes.css); everywhere else the wrappers are plain blocks
 * and the screens look as they always did.
 * ───────────────────────────────────────────────────────────────────────── */

export interface DuoAuthBrandProps {
  /** The named steps (onboardingSteps.ts); omit for the plain brand page (sign-in, joiner). */
  plan?: BrandPlan;
}

/** Figma "Brand pane": black page, Logo/Mark 56, BANDWITH label, Display 44 headline, step list. */
export const DuoAuthBrand: React.FC<DuoAuthBrandProps> = ({ plan }) => {
  const t = useT();
  // What each row is called; the ids come from the plan.
  const rowLabel: Record<BrandRow['id'], string> = {
    account: t('Create account'),
    intent: t('Choose your path'),
    band: t('Name your band'),
    profile: t('About you'),
    invite: t('Invite bandmates'),
    songs: t('Build your repertoire'),
    rest: t('Your setup'),
  };
  // "Set up" + what is being set up: the account until the path is chosen.
  const subject: Record<BrandPlan['subject'], string> = {
    account: t('your account.'),
    band: t('your band.'),
    solo: t('your schedule.'),
  };
  // One column for the numbers ("3–6" is wider than "3"), so the names line up.
  const numberWidth = plan ? Math.max(...plan.rows.map((row) => brandRowNumber(row).length)) : 0;
  const rowTone = (state: BrandRowState) => (state === 'done' ? 'opacity-75' : state === 'upcoming' ? 'opacity-40' : '');
  return (
  <aside className="bw-auth-brand select-none" aria-hidden="true">
    <BrandMark size={56} color="#fff" title="" />
    <p className="bw-label-md text-white mt-5">BandWith</p>
    <p className="bw-auth-brand-title bw-display-lg text-white mt-5">
      {plan ? (
        <>
          {t('Set up')}
          <br />
          {subject[plan.subject]}
        </>
      ) : (
        <>
          {t('Run the')}
          <br />
          {t('band.')}
        </>
      )}
    </p>
    {plan && (
      <ol className="mt-[63px] flex flex-col gap-[10px]" data-step={plan.step} data-total={plan.total}>
        {plan.rows.map((row) => (
          <li
            key={row.id}
            aria-current={row.state === 'current' ? 'step' : undefined}
            className={cn('flex items-center gap-[10px] h-[14px]', rowTone(row.state))}
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', row.state === 'current' ? 'bg-accent' : 'bg-white')} />
            <span className="bw-label-md text-white whitespace-pre">{`${brandRowNumber(row).padEnd(numberWidth)}  ${rowLabel[row.id]}`}</span>
          </li>
        ))}
        {/* The finish is not a step: no number, and a ring until it is reached. */}
        <li
          aria-current={plan.finish === 'current' ? 'step' : undefined}
          className={cn('flex items-center gap-[10px] h-[14px]', rowTone(plan.finish))}
        >
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              plan.finish === 'current' ? 'bg-accent' : 'border-[1.5px] border-white',
            )}
          />
          <span className="bw-label-md text-white whitespace-pre">{`${' '.repeat(numberWidth)}  ${t('Ready to rock')}`}</span>
        </li>
      </ol>
    )}
  </aside>
  );
};

/**
 * Brand page + trailing page around an auth/onboarding screen. On the closed
 * display and on phones the wrappers add nothing.
 */
export const DuoAuthLayout: React.FC<
  DuoAuthBrandProps & {
    /** Changes with the screen shown: the trailing page starts at the top again. */
    screenKey?: string;
    children: React.ReactNode;
  }
> = ({ plan, screenKey, children }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [screenKey]);
  return (
    <>
      <DuoAuthBrand plan={plan} />
      <div className="bw-auth-trailing">
        <div ref={scrollRef} className="bw-auth-trailing-scroll">
          {children}
        </div>
      </div>
    </>
  );
};
