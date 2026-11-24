import { useState } from 'react';
import type { Block, Role, ShotDevice } from '../content/types';
import { ROLE_LABEL } from '../content';
import { u } from './ui';
import { SHOT_FILES, SHOT_SIZES } from '../content/shotFiles';
import { shotFor, useViewDevice, VIEW_DEVICE_LABEL } from './viewer';
import { Inline } from './inline';
import { DeviceGlyph, DEVICE_SHORT } from './devices';
import { AlertTriangle, Lock, Sparkles, Image as ImageIcon } from 'lucide-react';
import { MusicSymbol } from '@/app/components/ui/MusicSymbol';
import type { MusicSymbolId } from '@/lib/musicSymbols';

export function RoleChip({ role, on = true }: { role: Role; on?: boolean }) {
  return <span className={`chip chip--${role}${on ? '' : ' chip--off'}`}>{ROLE_LABEL[role]}</span>;
}

function Shot({ id, caption, device: pinned }: { id: string; caption: string; device?: ShotDevice }) {
  const { device: want } = useViewDevice();
  const [failed, setFailed] = useState<string | null>(null);
  const [tall, setTall] = useState(false);
  // The reader's own device, or the nearest one captured. A pinned shot
  // (a screen that exists on one device only) always shows that device.
  const dev = pinned ? ((SHOT_FILES[id] ?? []).includes(pinned) ? pinned : null) : shotFor(id, want);
  const src = dev ? `./shots/${id}@${dev}.webp` : null;
  // The file's own size: the frame keeps its place (and its ratio) while the capture loads.
  const size = dev ? SHOT_SIZES[`${id}@${dev}`] : undefined;
  const kind = dev ?? pinned ?? want;
  const portrait = kind === 'phone' || kind === 'duoClosed';
  return (
    <figure className={`shot shot--${kind}`}>
      {!src || failed === src ? (
        <div className="shot__missing">
          <ImageIcon size={22} />
          <span>Screenshot coming: {id}</span>
        </div>
      ) : (
        <div className={`shot__frame shot__frame--${kind}`}>
          {kind === 'web' && (
            <div className="shot__bar" aria-hidden>
              <i />
              <i />
              <i />
              <span>app.bandwith.fun</span>
            </div>
          )}
          <div
            className="shot__screen"
            tabIndex={portrait && tall ? 0 : undefined}
            aria-label={portrait && tall ? u('Scrollable screenshot') : undefined}
          >
            <img
              key={src}
              src={src}
              alt={caption}
              width={size?.[0]}
              height={size?.[1]}
              loading="lazy"
              onError={() => setFailed(src)}
              onLoad={(e) => {
                const img = e.currentTarget;
                setTall(img.naturalHeight / img.naturalWidth > 2.3);
              }}
            />
          </div>
          {(kind === 'duoBook' || kind === 'duoLaptop') && <span className="shot__hinge" aria-hidden />}
          {portrait && tall && <span className="shot__scroll">{u('Scroll inside')}</span>}
        </div>
      )}
      <figcaption>
        <span className="dev shot__dev">
          <DeviceGlyph device={kind} size={16} />
          {VIEW_DEVICE_LABEL[kind]}
        </span>
        <span>
          <Inline text={caption} />
        </span>
      </figcaption>
    </figure>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'p':
      return (
        <p>
          <Inline text={b.text} />
        </p>
      );
    case 'steps':
      return (
        <section className="steps">
          {b.title && <h3 className="steps__title">{b.title}</h3>}
          <ol>
            {b.items.map((it, i) => (
              <li key={i}>
                <span className="steps__n">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <Inline text={it} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'list':
      return (
        <section className="list">
          {b.title && <h3 className="list__title">{b.title}</h3>}
          <ul>
            {b.items.map((it, i) => (
              <li key={i}>
                <Inline text={it} />
              </li>
            ))}
          </ul>
        </section>
      );
    case 'note': {
      const Icon = b.tone === 'privacy' ? Lock : b.tone === 'warning' ? AlertTriangle : Sparkles;
      const label = b.tone === 'privacy' ? u('Privacy') : b.tone === 'warning' ? u('Careful') : u('Tip');
      return (
        <aside className={`note note--${b.tone}`}>
          <span className="note__label">
            <Icon size={16} /> {label}
          </span>
          <p>
            <Inline text={b.text} />
          </p>
        </aside>
      );
    }
    case 'roles':
      return (
        <section className="rolesBlock">
          <h3 className="mini">{u('By role')}</h3>
          {b.rows.map((r, i) => (
            <div className="rolesBlock__row" key={i}>
              <RoleChip role={r.role} />
              <p>
                <Inline text={r.text} />
              </p>
            </div>
          ))}
        </section>
      );
    case 'devices':
      return (
        <section className="devBlock">
          <h3 className="mini">{u('On your device')}</h3>
          {b.rows.map((r, i) => (
            <div className="devBlock__row" key={i}>
              <div className="devBlock__devs">
                {r.devices.map((d) => (
                  <span className="dev" key={d} title={DEVICE_SHORT[d]}>
                    <DeviceGlyph device={d} size={18} />
                    {DEVICE_SHORT[d]}
                  </span>
                ))}
              </div>
              <p>
                <Inline text={r.text} />
              </p>
            </div>
          ))}
        </section>
      );
    case 'shot':
      return <Shot id={b.id} caption={b.caption} device={b.device} />;
    case 'symbols':
      // The app's own symbols (src/app/components/ui/MusicSymbol.tsx), so the guide shows what the chart shows.
      return (
        <section className="symbols">
          {b.title && <h3>{b.title}</h3>}
          <dl className="symbols__list">
            {b.rows.map((r, i) => (
              <div key={i} className="symbols__row">
                <dt>
                  <MusicSymbol id={r.symbol as MusicSymbolId} n={r.n} name={r.name} size={1.4} decorative />
                </dt>
                <dd>
                  <Inline text={r.text} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case 'table':
      return (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i}>
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
