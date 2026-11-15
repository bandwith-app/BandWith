import { useState } from 'react';
import { BY_ID } from '../content';
import type { Role } from '../content/types';
import { Inline } from './inline';
import { ArrowLeft, ArrowRight, BookOpen, Calendar, ChevronRight, HelpCircle, MapPin, Music, X } from 'lucide-react';

/**
 * Mock-ups of how the Academy could show up inside the app. Nothing here is
 * wired into the app yet: the user wants to approve the content first.
 */

const TOUR: Record<Role, { t: string; d: string; link: string }[]> = {
  admin: [
    { t: 'Welcome to your band', d: 'Home shows what needs you next: answers missing, payouts due, the next gig.', link: 'roles-overview' },
    { t: 'Put a gig in the calendar', d: 'Tap + to create a gig, a rehearsal, a poll or a quote. Members get a push to answer.', link: 'create-a-gig' },
    { t: 'Fees stay private', d: 'Each member sees only their own fee and the logistics. Totals and quotes are yours.', link: 'who-sees-what' },
    { t: 'Build the setlist', d: 'Pick songs from the repertoire, split them into sets and open Stage on the night.', link: 'build-a-setlist' },
  ],
  member: [
    { t: 'Welcome to the band', d: 'Home shows your next gig, what to answer and what changed.', link: 'roles-overview' },
    { t: 'Answer gigs and polls', d: 'Say if you can play, vote on rehearsal dates, and see your fee for each gig.', link: 'answer-a-gig-invitation' },
    { t: 'Practise the repertoire', d: 'Chords, lyrics, your own notes and files for every song. Stage mode follows the leader.', link: 'repertoire-overview' },
  ],
  deputy: [
    { t: 'You’re covering a gig', d: 'The band asked you to stand in. Accept or decline from the link or in the app.', link: 'deputies' },
    { t: 'Everything for the night', d: 'Time, place, your fee and what to bring. Nothing else of the band is shared.', link: 'who-sees-what' },
    { t: 'All your gigs in one place', d: 'Deputy gigs lists every band you cover for, and can sync to your calendar.', link: 'deputy-gigs' },
  ],
};

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mockPhone">
      <div className="mockPhone__screen">{children}</div>
    </div>
  );
}

function HelpDemo() {
  const [open, setOpen] = useState(false);
  const a = BY_ID.get('gig-workspace') ?? BY_ID.get('create-a-gig');
  return (
    <PhoneFrame>
      <div className="mockApp">
        <div className="mockApp__bar">
          <ArrowLeft size={20} />
          <span className="mockApp__title">Jazz Club Night</span>
          <button className="mockHelp" onClick={() => setOpen(true)} aria-label="Help for this screen">
            <HelpCircle size={20} />
          </button>
        </div>
        <div className="mockApp__hero">
          <span className="mockTag">Gig</span>
          <b>Sat 28 Nov · 22:00</b>
          <span>
            <MapPin size={14} /> Blue Note, Milano
          </span>
        </div>
        <div className="mockApp__rows">
          {['Overview', 'Setlist', 'Rider & stage', 'Readiness'].map((r) => (
            <div key={r} className="mockApp__row">
              {r} <ChevronRight size={16} />
            </div>
          ))}
        </div>
        {open && (
          <div className="mockSheet" onClick={() => setOpen(false)}>
            <div className="mockSheet__card" onClick={(e) => e.stopPropagation()}>
              <div className="mockSheet__head">
                <span className="mini">Academy</span>
                <button className="iconBtn" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <b className="mockSheet__t">{a?.title ?? 'The gig workspace'}</b>
              <p>{a ? <Inline text={a.summary} /> : null}</p>
              <a className="btn btn--lime" href={a ? `#/a/${a.id}` : '#/'}>
                <BookOpen size={16} /> Open in Academy
              </a>
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function TourDemo() {
  const [role, setRole] = useState<Role>('admin');
  const [step, setStep] = useState(0);
  const steps = TOUR[role];
  const s = steps[Math.min(step, steps.length - 1)];
  return (
    <div className="tourDemo">
      <div className="roleSwitch">
        {(['admin', 'member', 'deputy'] as Role[]).map((r) => (
          <button
            key={r}
            className={r === role ? 'on' : ''}
            onClick={() => {
              setRole(r);
              setStep(0);
            }}
          >
            {r[0].toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>
      <PhoneFrame>
        <div className="mockTour">
          <div className="mockTour__art">
            {step % 3 === 0 ? <Calendar size={44} /> : step % 3 === 1 ? <Music size={44} /> : <BookOpen size={44} />}
          </div>
          <div className="mockTour__dots">
            {steps.map((_, i) => (
              <span key={i} className={i === step ? 'on' : ''} />
            ))}
          </div>
          <b className="mockTour__t">{s.t}</b>
          <p>{s.d}</p>
          {BY_ID.get(s.link) && (
            <a className="mockTour__more" href={`#/a/${s.link}`}>
              Learn more in the Academy <ArrowRight size={14} />
            </a>
          )}
          <div className="mockTour__nav">
            <button className="btn btn--ghost" onClick={() => setStep(steps.length - 1)}>
              Skip
            </button>
            <button
              className="btn btn--lime"
              onClick={() => setStep((n) => (n + 1 < steps.length ? n + 1 : 0))}
            >
              {step + 1 < steps.length ? 'Next' : 'Done'}
            </button>
          </div>
        </div>
      </PhoneFrame>
    </div>
  );
}

export function PreviewPage() {
  return (
    <>
      <nav className="crumbs">
        <a href="#/">Academy</a> <ChevronRight size={14} /> <span>In-app preview</span>
      </nav>
      <header className="pageHead">
        <HelpCircle size={32} />
        <h1>How the Academy could live in the app</h1>
        <p className="lede">
          Mock-ups only: nothing here is in the app yet. Once the content is approved, the app opens these same pages in
          an in-app web view.
        </p>
      </header>
      <section className="previewGrid">
        <div className="previewCard">
          <h2>1 · Help where you are</h2>
          <p>
            A <b>?</b> at the top of the main screens opens a short sheet with the matching guide, and a button to read
            it in full. Tap the <b>?</b> on the phone.
          </p>
          <HelpDemo />
        </div>
        <div className="previewCard">
          <h2>2 · First-run tour</h2>
          <p>
            Today only admins get a tour (4 steps, mostly about pricing and quotes). The idea: a short tour for each
            role, every card with a <b>Learn more</b> link to the Academy. Skippable, and you can see it again from
            Settings. Switch role above the phone.
          </p>
          <TourDemo />
        </div>
        <div className="previewCard previewCard--wide">
          <h2>3 · Settings › Academy</h2>
          <p>
            A row in Settings (next to Help) opens the Academy home in an in-app web view, in your app language once the
            translations exist. The pages need a connection; the app keeps working offline as it does today.
          </p>
        </div>
      </section>
    </>
  );
}
