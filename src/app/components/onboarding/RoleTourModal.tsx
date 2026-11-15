import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Calendar,
  Check,
  Crown,
  DollarSign,
  Lock,
  Music,
  UserCheck,
  X,
} from '@/app/components/icons';
import { PillButton, Selector } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import type { AcademyRole, AcademyTarget } from '@/lib/academy';
import { AcademySheet } from '@/app/components/academy/AcademySheet';

/**
 * First-run tour, one per role (admin, member, deputy). Each card links to
 * the matching BandWith Academy guide. Replaces the old admin-only tour.
 * Seen once per role and device (`roleTourSeen`); Settings can show it again.
 */

const SEEN_KEY = (role: AcademyRole) => `bw-role-tour-seen:${role}`;

export const roleTourSeen = (role: AcademyRole): boolean => {
  try {
    return localStorage.getItem(SEEN_KEY(role)) === '1';
  } catch {
    return true; // storage blocked: don't nag on every start
  }
};

export const markRoleTourSeen = (role: AcademyRole) => {
  try {
    localStorage.setItem(SEEN_KEY(role), '1');
  } catch {
    /* storage blocked */
  }
};

interface TourStep {
  label: string;
  title: string;
  content: string;
  highlights: string[];
  icon: React.ComponentType<{ className?: string }>;
  /** Academy article for Learn more. */
  article: string;
}

// Built per render so the text follows the app language.
const STEPS = (t: (s: string) => string): Record<AcademyRole, TourStep[]> => ({
  admin: [
    {
      label: t('Welcome to BandWith'),
      title: t('Your band in one place'),
      content: t('Home shows what needs you next: missing answers, payouts due and the next gig.'),
      highlights: [
        t('Create gigs, rehearsals, polls and quotes with +'),
        t('Invite your bandmates from Band members'),
        t('Your first gig takes about ten minutes'),
      ],
      icon: Crown,
      article: 'first-gig-in-10-minutes',
    },
    {
      label: t('Gigs'),
      title: t('Put a gig on the calendar'),
      content: t('Pick the lineup and each musician’s fee. They get an invitation and answer from their phone.'),
      highlights: [
        t('See who answered on the gig'),
        t('Find a deputy when someone can’t make it'),
        t('Share the rider with the venue'),
      ],
      icon: Calendar,
      article: 'create-a-gig',
    },
    {
      label: t('Privacy'),
      title: t('Fees stay private'),
      content: t('Each member sees only their own fee and the logistics. Quotes, totals and finances stay with the admins.'),
      highlights: [
        t('Members never see other people’s fees'),
        t('Only admins edit setlists and contracts'),
        t('Deputies see only the gigs they cover'),
      ],
      icon: Lock,
      article: 'who-sees-what',
    },
    {
      label: t('Quotes & pricing'),
      title: t('Set your rates once'),
      content: t('Pricing, fees & services feeds every quote: musician fees, packages, travel and extras.'),
      highlights: [
        t('Send a quote the client confirms online'),
        t('Turn an accepted quote into a gig'),
        t('Track payouts and revenue'),
      ],
      icon: DollarSign,
      article: 'pricing-sheet',
    },
  ],
  member: [
    {
      label: t('Welcome to BandWith'),
      title: t('Your band in one place'),
      content: t('Home shows your next gig, what to answer and what changed.'),
      highlights: [
        t('Answer gigs and rehearsal polls'),
        t('See your own fee for each gig'),
        t('Chat with the whole band or one gig'),
      ],
      icon: BookOpen,
      article: 'roles-overview',
    },
    {
      label: t('Gigs'),
      title: t('Answer in one tap'),
      content: t('When an admin adds you to a gig, you get an invitation with the date, the venue and your fee.'),
      highlights: [
        t('Accept or decline the invitation'),
        t('Times, address and rider are on the gig'),
        t('Drop out early if your plans change'),
      ],
      icon: Calendar,
      article: 'answer-a-gig-invitation',
    },
    {
      label: t('Music'),
      title: t('Ready for the night'),
      content: t('Every song has chords, lyrics and your own private notes. On stage, follow the leader in Stage mode.'),
      highlights: [
        t('Suggest songs and corrections'),
        t('Transpose and switch the view'),
        t('Read the gig’s setlist'),
      ],
      icon: Music,
      article: 'repertoire-overview',
    },
  ],
  deputy: [
    {
      label: t('Deputy gigs'),
      title: t('You’re covering a gig'),
      content: t('A band asked you to stand in. Answer from the request link or here in the app.'),
      highlights: [
        t('Accept, decline or answer later'),
        t('Your fee is in each request'),
        t('The band’s admins see your answer at once'),
      ],
      icon: UserCheck,
      article: 'deputy-in-the-app',
    },
    {
      label: t('Privacy'),
      title: t('Only what you need'),
      content: t('You see the gig’s times, the venue and your fee. The street address appears after you say yes.'),
      highlights: [
        t('Nothing else of the band is shared'),
        t('Other fees and the setlist stay private'),
        t('Your answer goes only to the band’s admins'),
      ],
      icon: Lock,
      article: 'who-sees-what',
    },
    {
      label: t('Calendar'),
      title: t('All your deputy gigs'),
      content: t('Deputy gigs lists every band you cover for. Add them to your calendar so you never double-book.'),
      highlights: [
        t('Every band in one list'),
        t('Subscribe from your calendar app'),
        t('Play in a band too? Set it up from here'),
      ],
      icon: Calendar,
      article: 'deputy-gigs',
    },
  ],
});

export const RoleTourModal: React.FC<{
  role: AcademyRole;
  onClose: () => void;
  /** Admins: the last card offers Configure rates. */
  onOpenPricing?: () => void;
}> = ({ role, onClose, onOpenPricing }) => {
  const t = useT();
  const [current, setCurrent] = useState(0);
  const [academy, setAcademy] = useState<AcademyTarget | undefined>(undefined);
  const steps = STEPS(t)[role];
  const step = steps[current];
  const isLast = current === steps.length - 1;
  const StepIcon = step.icon;

  const close = () => {
    markRoleTourSeen(role);
    onClose();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="bw-pane-dialog fixed inset-0 z-[120] bg-black/65 flex items-center justify-center p-4"
        style={{ paddingTop: 'calc(var(--safe-top) + 16px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-tour-title"
          initial={{ scale: 0.94, y: 15 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.94, y: 15 }}
          className="dark w-full max-w-[420px] max-h-full overflow-y-auto bg-sheet text-sheet-foreground rounded-[24px] p-6 flex flex-col gap-4 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
        >
          <div className="flex items-center justify-between">
            <Selector className="bg-accent text-accent-foreground">
              {t('Step {step} of {total}', { step: current + 1, total: steps.length })}
            </Selector>
            <button
              type="button"
              onClick={close}
              aria-label={t('Close tour')}
              className="-m-1 p-1 rounded-full active:scale-[var(--press-scale,0.97)] transition-transform"
            >
              <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-foreground text-foreground">
                <X className="w-4 h-4" strokeWidth={2} />
              </span>
            </button>
          </div>

          <div className="w-16 h-16 rounded-[16px] bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <StepIcon className="w-[29px] h-[29px]" />
          </div>

          <p className="bw-label-sm text-muted-foreground">{step.label}</p>
          <h2 id="role-tour-title" className="bw-h1 text-foreground">
            {step.title}
          </h2>
          <p className="text-[16px] leading-[1.45] tracking-[-0.003em] text-muted-foreground">{step.content}</p>

          <ul className="flex flex-col gap-4">
            {step.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-3 text-[16px] leading-[1.45] tracking-[-0.003em] text-foreground">
                <Check className="w-4 h-4 mt-[5px] shrink-0 text-accent" strokeWidth={2.5} aria-hidden />
                <span>{h}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setAcademy({ article: step.article })}
            className="self-start flex items-center gap-2 bw-label-sm text-accent underline underline-offset-4 active:opacity-70"
          >
            <BookOpen className="w-4 h-4" aria-hidden />
            {t('Learn more in the Academy')}
          </button>

          {isLast && onOpenPricing && (
            <PillButton
              variant="outline"
              size="md"
              onClick={() => {
                markRoleTourSeen(role);
                onOpenPricing();
              }}
            >
              {t('Configure rates')}
            </PillButton>
          )}

          {/* Footer: stays in view when the card scrolls (Laptop pose, closed Duo
              in landscape, small phones), so Next / Done is always reachable. */}
          <div className="bw-dialog-footer sticky -bottom-6 -mx-6 -mb-6 px-6 pt-3 pb-6 bg-sheet flex items-center justify-between gap-3">
            <div className="flex items-center gap-1" aria-hidden>
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2.5 rounded-full transition-all duration-300',
                    i === current ? 'w-6 bg-accent' : 'w-2.5 bg-dot-off',
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {current > 0 && (
                <PillButton variant="outline" size="md" fullWidth={false} onClick={() => setCurrent((n) => n - 1)}>
                  {t('Back')}
                </PillButton>
              )}
              <PillButton size="md" fullWidth={false} onClick={isLast ? close : () => setCurrent((n) => n + 1)}>
                {isLast ? t('Done') : t('Next')}
              </PillButton>
            </div>
          </div>
        </motion.div>
      </motion.div>
      <AcademySheet target={academy} onClose={() => setAcademy(undefined)} />
    </>
  );
};
