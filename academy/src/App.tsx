import { useEffect, useMemo, useRef, useState } from 'react';
import { ARTICLES, BY_ID, FAQ, GLOSSARY, MODULES, ROLE_LABEL, SHOTS, areaOf, type Indexed } from '../content';
import type { Role, ShotDevice } from '../content/types';
import { DeviceGlyph } from './devices';
import { useViewDevice, VIEW_DEVICES, VIEW_DEVICE_LABEL } from './viewer';
import { Blocks, RoleChip } from './blocks';
import { Inline, brokenLinks, highlight, plain } from './inline';
import { search, terms, type Hit } from './search';
import { LANG, LANGS, pickLang, type Lang } from './lang';
import { searchSuggestions, u } from './ui';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  ChevronRight,
  Crown,
  FileText,
  HelpCircle,
  Home,
  ListChecks,
  MessageCircle,
  Moon,
  Music,
  Search,
  Shield,
  Smartphone,
  Sun,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

/* ── Routing (hash based: works as static files, in an iframe or a webview) ── */

type Route =
  | { name: 'home' }
  | { name: 'role'; role: Role }
  | { name: 'area'; id: string }
  | { name: 'article'; id: string }
  | { name: 'faq' }
  | { name: 'glossary' }
  | { name: 'dev' };

const parse = (hash: string): Route => {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'role' && (b === 'admin' || b === 'member' || b === 'deputy')) return { name: 'role', role: b };
  if (a === 'area' && b) return { name: 'area', id: b };
  if (a === 'a' && b) return { name: 'article', id: b };
  if (a === 'faq') return { name: 'faq' };
  if (a === 'glossary') return { name: 'glossary' };
  if (a === 'dev') return { name: 'dev' };
  return { name: 'home' };
};

function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/* ── Embedded in the app (?embed=1&theme=dark|light) ── */

const params = new URLSearchParams(location.search);
/** Opened from the app (Settings › Academy, a ? button or a tour card). */
export const EMBEDDED = params.get('embed') === '1';
// The app's sheet keeps clear of the device's safe areas (styles.css).
if (EMBEDDED) document.documentElement.dataset.embed = '1';
const APP_THEME = params.get('theme');

/* ── Theme ── */

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (APP_THEME === 'light' || APP_THEME === 'dark') return APP_THEME;
    try {
      const saved = localStorage.getItem('bw-academy-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* storage blocked */
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (EMBEDDED) return; // follow the app; don't overwrite the web visitor's choice
    try {
      localStorage.setItem('bw-academy-theme', theme);
    } catch {
      /* storage blocked */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

/* ── Device picker: screenshots follow the reader's device, or the one picked here ── */

function DevicePicker() {
  const { device, auto, picked, pick } = useViewDevice();
  return (
    <label className={`devicePick${picked ? ' devicePick--picked' : ''}`} title={u('Show screens for')}>
      <DeviceGlyph device={device} size={20} />
      <span className="devicePick__label">{VIEW_DEVICE_LABEL[device]}</span>
      <select
        aria-label={u('Show screens for')}
        value={picked ? device : 'auto'}
        onChange={(e) => pick(e.target.value === 'auto' ? null : (e.target.value as ShotDevice))}
      >
        <option value="auto">{u('This device ({device})', { device: VIEW_DEVICE_LABEL[auto] })}</option>
        {VIEW_DEVICES.filter((d) => d !== auto).map((d) => (
          <option key={d} value={d}>
            {VIEW_DEVICE_LABEL[d]}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── Language picker (web only: inside the app the guide follows the app's language) ── */

function LangPicker({ full = false }: { full?: boolean }) {
  const name = LANGS.find((l) => l.id === LANG)?.name ?? LANG;
  return (
    <label className="devicePick langPick" title={u('Language')}>
      <span className="devicePick__label">{full ? `${u('Language')}: ${name}` : LANG.toUpperCase()}</span>
      <select aria-label={u('Language')} value={LANG} onChange={(e) => pickLang(e.target.value as Lang)}>
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── Shared bits ── */

const AREA_ICON: Record<string, typeof Home> = {
  home: Home,
  calendar: Calendar,
  document: FileText,
  chat: MessageCircle,
  music: Music,
  people: Users,
};

const ROLE_ICON: Record<Role, typeof Home> = { admin: Crown, member: User, deputy: UserCheck };

const ROLE_INTRO: Record<Role, string> = {
  admin: u(
    'You run the band: you create gigs and rehearsals, send quotes and contracts, set fees, build setlists and decide who joins.',
  ),
  member: u(
    'You play in the band: you answer gigs and polls, see your own fee and the logistics, practise the repertoire and chat with the band.',
  ),
  deputy: u(
    'You stand in for a band member on some gigs: you reply to the request, see your fee and the logistics, and can follow it all in the app.',
  ),
};

const ROLE_TITLE: Record<Role, string> = {
  admin: u("I'm an admin"),
  member: u("I'm a member"),
  deputy: u("I'm a deputy"),
};

/** Hand-picked first reads per role; ids that don't exist are skipped. */
const START_HERE: Record<Role, string[]> = {
  admin: ['first-gig-in-10-minutes', 'roles-overview', 'invite-members', 'create-a-gig', 'gig-workspace', 'create-a-quote', 'build-a-setlist', 'who-sees-what'],
  member: ['roles-overview', 'join-with-an-invite', 'what-members-see-on-a-gig', 'answer-a-gig-invitation', 'vote-in-a-rehearsal-poll', 'repertoire-overview', 'follow-in-stage-mode', 'my-notes-and-files', 'who-sees-what'],
  deputy: ['deputies', 'deputy-reply-page', 'deputy-in-the-app', 'deputy-gigs', 'deputy-notifications', 'who-sees-what'],
};

const go = (hash: string) => {
  location.hash = hash;
};

function ArticleRow({ a, showArea = false }: { a: Indexed; showArea?: boolean }) {
  const area = areaOf(a.areaId);
  return (
    <a className="row" href={`#/a/${a.id}`}>
      <span className="row__main">
        <span className="row__title">{a.title}</span>
        <span className="row__sum">
          <Inline text={a.summary} />
        </span>
      </span>
      <span className="row__meta">
        {showArea && area && <span className="row__area">{area.area.title}</span>}
        <span className="row__roles">
          {a.roles.map((r) => (
            <RoleChip key={r} role={r} />
          ))}
        </span>
        <ChevronRight size={18} />
      </span>
    </a>
  );
}

/* ── Pages ── */

function HomePage() {
  const first = BY_ID.get('first-gig-in-10-minutes');
  const devices = BY_ID.get('device-differences');
  const who = BY_ID.get('who-sees-what');
  return (
    <>
      <section className="hero">
        <p className="eyebrow">BandWith Academy</p>
        <h1>{u('Everything your band can do, step by step.')}</h1>
        <p className="lede">
          {u('{n} guides for admins, members and deputies, on phone, iPad, dual-screen, Android and the web.', { n: ARTICLES.length })}
        </p>
        <button className="heroSearch" onClick={() => window.dispatchEvent(new Event('academy:search'))}>
          <Search size={20} />
          <span>{u('Search the Academy')}</span>
          <kbd>/</kbd>
        </button>
      </section>

      <section className="block">
        <h2 className="mini">{u('Start with your role')}</h2>
        <div className="roles">
          {(['admin', 'member', 'deputy'] as Role[]).map((r) => {
            const Icon = ROLE_ICON[r];
            const n = ARTICLES.filter((a) => a.roles.includes(r)).length;
            return (
              <a key={r} className={`roleCard roleCard--${r}`} href={`#/role/${r}`}>
                <Icon size={28} />
                <span className="roleCard__t">{ROLE_TITLE[r]}</span>
                <span className="roleCard__d">{ROLE_INTRO[r]}</span>
                <span className="roleCard__n">
                  {u('{n} guides', { n })} <ArrowRight size={16} />
                </span>
              </a>
            );
          })}
        </div>
      </section>

      <section className="block feature">
        {first && (
          <a className="featureCard featureCard--lime" href={`#/a/${first.id}`}>
            <ListChecks size={28} />
            <span className="featureCard__t">{first.title}</span>
            <span className="featureCard__d">
              <Inline text={first.summary} />
            </span>
          </a>
        )}
        {who && (
          <a className="featureCard" href={`#/a/${who.id}`}>
            <Shield size={28} />
            <span className="featureCard__t">{who.title}</span>
            <span className="featureCard__d">
              <Inline text={who.summary} />
            </span>
          </a>
        )}
        {devices && (
          <a className="featureCard" href={`#/a/${devices.id}`}>
            <Smartphone size={28} />
            <span className="featureCard__t">{devices.title}</span>
            <span className="featureCard__d">
              <Inline text={devices.summary} />
            </span>
          </a>
        )}
      </section>

      <section className="block">
        <h2 className="mini">{u('Browse by area')}</h2>
        <div className="areas">
          {MODULES.map((m) => {
            const Icon = AREA_ICON[m.area.icon] ?? BookOpen;
            return (
              <a key={m.area.id} className="areaCard" href={`#/area/${m.area.id}`}>
                <Icon size={26} />
                <span className="areaCard__t">{m.area.title}</span>
                <span className="areaCard__d">{m.area.intro}</span>
                <span className="areaCard__n">{u('{n} guides', { n: m.articles.length })}</span>
              </a>
            );
          })}
        </div>
      </section>

      <section className="block twoUp">
        <a className="linkCard" href="#/faq">
          <HelpCircle size={24} />
          <span>
            <b>{u('FAQ & common problems')}</b>
            <small>{u('{n} answers', { n: FAQ.length })}</small>
          </span>
          <ChevronRight size={18} />
        </a>
        <a className="linkCard" href="#/glossary">
          <BookOpen size={24} />
          <span>
            <b>{u('Glossary')}</b>
            <small>{u('{n} terms', { n: GLOSSARY.length })}</small>
          </span>
          <ChevronRight size={18} />
        </a>
      </section>
    </>
  );
}

function RolePage({ role }: { role: Role }) {
  const Icon = ROLE_ICON[role];
  const start = START_HERE[role].map((id) => BY_ID.get(id)).filter((a): a is Indexed => !!a && a.roles.includes(role));
  const startIds = new Set(start.map((a) => a.id));
  return (
    <>
      <nav className="crumbs">
        <a href="#/">Academy</a> <ChevronRight size={14} /> <span>{ROLE_LABEL[role]}</span>
      </nav>
      <header className={`pageHead pageHead--${role}`}>
        <Icon size={32} />
        <h1>{ROLE_TITLE[role]}</h1>
        <p className="lede">{ROLE_INTRO[role]}</p>
        <div className="roleSwitch">
          {(['admin', 'member', 'deputy'] as Role[]).map((r) => (
            <a key={r} href={`#/role/${r}`} className={r === role ? 'on' : ''}>
              {ROLE_LABEL[r]}
            </a>
          ))}
        </div>
      </header>
      {start.length > 0 && (
        <section className="block">
          <h2 className="mini">{u('Start here')}</h2>
          <ol className="path">
            {start.map((a, i) => (
              <li key={a.id}>
                <a href={`#/a/${a.id}`}>
                  <span className="path__n">{i + 1}</span>
                  <span className="path__t">{a.title}</span>
                  <span className="path__s">
                    <Inline text={a.summary} />
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      {MODULES.map((m) => {
        const list = m.articles
          .map((a) => BY_ID.get(a.id)!)
          .filter((a) => a.roles.includes(role) && !startIds.has(a.id));
        if (!list.length) return null;
        return (
          <section className="block" key={m.area.id}>
            <h2 className="mini">{m.area.title}</h2>
            <div className="rows">
              {list.map((a) => (
                <ArticleRow key={a.id} a={a} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function AreaPage({ id }: { id: string }) {
  const m = areaOf(id);
  if (!m) return <NotFound />;
  const Icon = AREA_ICON[m.area.icon] ?? BookOpen;
  const list = m.articles.map((a) => BY_ID.get(a.id)!);
  const tasks = list.filter((a) => a.kind === 'task');
  const refs = list.filter((a) => a.kind === 'reference');
  const faq = FAQ.filter((f) => f.areaId === id);
  return (
    <>
      <nav className="crumbs">
        <a href="#/">Academy</a> <ChevronRight size={14} /> <span>{m.area.title}</span>
      </nav>
      <header className="pageHead">
        <Icon size={32} />
        <h1>{m.area.title}</h1>
        <p className="lede">{m.area.intro}</p>
      </header>
      {refs.length > 0 && (
        <section className="block">
          <h2 className="mini">{u('Understand it')}</h2>
          <div className="rows">
            {refs.map((a) => (
              <ArticleRow key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}
      {tasks.length > 0 && (
        <section className="block">
          <h2 className="mini">{u('How do I…')}</h2>
          <div className="rows">
            {tasks.map((a) => (
              <ArticleRow key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}
      {faq.length > 0 && (
        <section className="block">
          <h2 className="mini">{u('Questions')}</h2>
          <FaqList items={faq} />
        </section>
      )}
    </>
  );
}

function ArticlePage({ id }: { id: string }) {
  const a = BY_ID.get(id);
  if (!a) return <NotFound />;
  const m = areaOf(a.areaId)!;
  const siblings = m.articles.map((x) => x.id);
  const idx = siblings.indexOf(a.id);
  const prev = idx > 0 ? BY_ID.get(siblings[idx - 1]) : undefined;
  const next = idx < siblings.length - 1 ? BY_ID.get(siblings[idx + 1]) : undefined;
  const related = (a.related ?? []).map((r) => BY_ID.get(r)).filter((x): x is Indexed => !!x);
  return (
    <div className="articleLayout">
      <aside className="toc">
        <a className="toc__area" href={`#/area/${m.area.id}`}>
          <ArrowLeft size={16} /> {m.area.title}
        </a>
        <ul>
          {m.articles.map((x) => (
            <li key={x.id}>
              <a href={`#/a/${x.id}`} className={x.id === a.id ? 'on' : ''}>
                {x.title}
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <article className="article">
        <nav className="crumbs">
          <a href="#/">Academy</a> <ChevronRight size={14} /> <a href={`#/area/${m.area.id}`}>{m.area.title}</a>
        </nav>
        <header className="article__head">
          <p className="eyebrow">{a.kind === 'task' ? u('How to') : u('Guide')}</p>
          <h1>{a.title}</h1>
          <p className="lede">
            <Inline text={a.summary} />
          </p>
          <div className="article__roles">
            <span className="mini">{u('For')}</span>
            {(['admin', 'member', 'deputy'] as Role[]).map((r) => (
              <RoleChip key={r} role={r} on={a.roles.includes(r)} />
            ))}
          </div>
        </header>
        <div className="article__body">
          <Blocks blocks={a.body} />
        </div>
        {related.length > 0 && (
          <section className="block">
            <h2 className="mini">{u('Related')}</h2>
            <div className="rows">
              {related.map((r) => (
                <ArticleRow key={r.id} a={r} showArea={r.areaId !== a.areaId} />
              ))}
            </div>
          </section>
        )}
        <nav className="pager">
          {prev ? (
            <a href={`#/a/${prev.id}`}>
              <small>{u('Previous')}</small>
              <span>
                <ArrowLeft size={16} /> {prev.title}
              </span>
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a href={`#/a/${next.id}`} className="pager__next">
              <small>{u('Next')}</small>
              <span>
                {next.title} <ArrowRight size={16} />
              </span>
            </a>
          )}
        </nav>
      </article>
    </div>
  );
}

function FaqList({ items }: { items: typeof FAQ }) {
  return (
    <div className="faq">
      {items.map((f, i) => (
        <details key={i}>
          <summary>
            <span>{f.q}</span>
            <ChevronRight size={18} />
          </summary>
          <p>
            <Inline text={f.a} />
          </p>
          {f.roles && (
            <div className="faq__roles">
              {f.roles.map((r) => (
                <RoleChip key={r} role={r} />
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

function FaqPage() {
  return (
    <>
      <nav className="crumbs">
        <a href="#/">Academy</a> <ChevronRight size={14} /> <span>{u('FAQ')}</span>
      </nav>
      <header className="pageHead">
        <HelpCircle size={32} />
        <h1>{u('FAQ & common problems')}</h1>
      </header>
      {MODULES.map((m) => {
        const items = FAQ.filter((f) => f.areaId === m.area.id);
        if (!items.length) return null;
        return (
          <section className="block" key={m.area.id}>
            <h2 className="mini">{m.area.title}</h2>
            <FaqList items={items} />
          </section>
        );
      })}
    </>
  );
}

function GlossaryPage() {
  const groups = useMemo(() => {
    const g = new Map<string, typeof GLOSSARY>();
    for (const t of GLOSSARY) {
      const k = t.term[0].toUpperCase();
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return [...g.entries()];
  }, []);
  return (
    <>
      <nav className="crumbs">
        <a href="#/">Academy</a> <ChevronRight size={14} /> <span>{u('Glossary')}</span>
      </nav>
      <header className="pageHead">
        <BookOpen size={32} />
        <h1>{u('Glossary')}</h1>
      </header>
      <div className="glossary">
        {groups.map(([k, list]) => (
          <section key={k}>
            <h2 className="glossary__k">{k}</h2>
            <dl>
              {list.map((t) => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd>
                    <Inline text={t.definition} />
                    {t.see && BY_ID.get(t.see) && (
                      <>
                        {' '}
                        <a className="xref" href={`#/a/${t.see}`}>
                          {u('Read more')}
                        </a>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

/** Internal checks: broken links, screenshots to capture. Not linked anywhere. */
function DevPage() {
  // render every article once so brokenLinks fills up
  const all = ARTICLES.map((a) => JSON.stringify(a)).join('');
  const ids = [...all.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim());
  const broken = [...new Set(ids.filter((id) => !BY_ID.has(id)))];
  brokenLinks.forEach((b) => broken.includes(b) || broken.push(b));
  const relBroken = ARTICLES.flatMap((a) => (a.related ?? []).filter((r) => !BY_ID.has(r)).map((r) => `${a.id} → ${r}`));
  return (
    <div className="dev">
      <h1>Dev</h1>
      <p>{ARTICLES.length} articles, {FAQ.length} FAQ, {GLOSSARY.length} terms, {SHOTS.size} shots</p>
      <h2>Broken inline links ({broken.length})</h2>
      <pre id="broken">{broken.join('\n')}</pre>
      <h2>Broken related ({relBroken.length})</h2>
      <pre id="relbroken">{relBroken.join('\n')}</pre>
      <h2>Shots</h2>
      <pre id="shots">{JSON.stringify([...SHOTS.values()], null, 1)}</pre>
    </div>
  );
}

function NotFound() {
  return (
    <div className="pageHead">
      <h1>{u('Not found')}</h1>
      <p className="lede">
        <a href="#/">{u('Back to the Academy')}</a>
      </p>
    </div>
  );
}

/* ── Search overlay ── */

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(q), [q]);
  const ts = useMemo(() => terms(q), [q]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const open = (h: Hit) => {
    if (h.kind === 'article') go(`#/a/${h.article.id}`);
    else if (h.kind === 'term') go(h.see && BY_ID.has(h.see) ? `#/a/${h.see}` : '#/glossary');
    else go(`#/area/${h.areaId}`);
    onClose();
  };

  return (
    <div className="searchScrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="searchBox" role="dialog" aria-label={u('Search the Academy')}>
        <div className="searchBox__field">
          <Search size={20} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={u('Search: setlist, deputy fee, laptop pose…')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, hits.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              }
              if (e.key === 'Enter' && hits[sel]) open(hits[sel]);
            }}
          />
          <button className="iconBtn" onClick={onClose} aria-label={u('Close search')}>
            <X size={20} />
          </button>
        </div>
        <div className="searchBox__results">
          {q && !hits.length && <p className="searchBox__empty">{u('No results. Try another word, or browse the areas.')}</p>}
          {!q && (
            <div className="searchBox__hint">
              <span className="mini">{u('Try')}</span>
              {searchSuggestions().map((s) => (
                <button key={s} onClick={() => setQ(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {hits.map((h, i) => (
            <button
              key={i}
              className={`hit${i === sel ? ' hit--on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => open(h)}
            >
              {h.kind === 'article' && (
                <>
                  <span className="hit__kind">{areaOf(h.article.areaId)?.area.title}</span>
                  <span className="hit__t">{highlight(h.article.title, ts)}</span>
                  <span className="hit__s">{highlight(h.snippet.length > 160 ? h.snippet.slice(0, 157) + '…' : h.snippet, ts)}</span>
                </>
              )}
              {h.kind === 'faq' && (
                <>
                  <span className="hit__kind">{u('FAQ')}</span>
                  <span className="hit__t">{highlight(h.q, ts)}</span>
                  <span className="hit__s">{highlight(h.a.length > 160 ? h.a.slice(0, 157) + '…' : h.a, ts)}</span>
                </>
              )}
              {h.kind === 'term' && (
                <>
                  <span className="hit__kind">{u('Glossary')}</span>
                  <span className="hit__t">{highlight(h.term, ts)}</span>
                  <span className="hit__s">{highlight(h.definition, ts)}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Shell ── */

export function App() {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const open = () => setSearching(true);
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea');
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('academy:search', open);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('academy:search', open);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => {
    const a = route.name === 'article' ? BY_ID.get(route.id) : undefined;
    const area = route.name === 'area' ? areaOf(route.id) : undefined;
    document.title = a ? `${a.title} · BandWith Academy` : area ? `${area.area.title} · BandWith Academy` : 'BandWith Academy';
  }, [route]);

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <span>
            BandWith <b>Academy</b>
          </span>
        </a>
        <nav className="top__nav">
          <a href="#/role/admin">{ROLE_LABEL.admin}</a>
          <a href="#/role/member">{ROLE_LABEL.member}</a>
          <a href="#/role/deputy">{ROLE_LABEL.deputy}</a>
          <a href="#/faq">{u('FAQ')}</a>
        </nav>
        <div className="top__tools">
          <button className="searchPill" onClick={() => setSearching(true)}>
            <Search size={18} />
            <span>{u('Search')}</span>
            <kbd>/</kbd>
          </button>
          <DevicePicker />
          {!EMBEDDED && <LangPicker />}
          {!EMBEDDED && (
            <button className="iconBtn" onClick={toggleTheme} aria-label={u('Switch theme')}>
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          )}
        </div>
      </header>
      <main className={`main main--${route.name}`}>
        {route.name === 'home' && <HomePage />}
        {route.name === 'role' && <RolePage role={route.role} />}
        {route.name === 'area' && <AreaPage id={route.id} />}
        {route.name === 'article' && <ArticlePage id={route.id} />}
        {route.name === 'faq' && <FaqPage />}
        {route.name === 'glossary' && <GlossaryPage />}
        {route.name === 'dev' && <DevPage />}
      </main>
      {!EMBEDDED && (
        <footer className="foot">
          <span>BandWith Academy</span>
          <LangPicker full />
          <span>
            <a href="#/glossary">{u('Glossary')}</a> · <a href="#/faq">{u('FAQ')}</a> · <a href="../">{u('Open BandWith')}</a>
          </span>
        </footer>
      )}
      {searching && <SearchOverlay onClose={() => setSearching(false)} />}
    </>
  );
}

export { plain };
