import { useState } from 'react';
import type { Block, Role, ShotDevice } from '../content/types';
import { ROLE_LABEL } from '../content';
import { SHOT_FILES } from '../content/shotFiles';
import { shotFor, useViewDevice, VIEW_DEVICE_LABEL } from './viewer';
import { Inline } from './inline';
import { DeviceGlyph, DEVICE_SHORT } from './devices';
import { AlertTriangle, Lock, Sparkles, Image as ImageIcon } from 'lucide-react';

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
              <span>bandwith-beryl.vercel.app</span>
            </div>
          )}
          <div
            className="shot__screen"
            tabIndex={portrait && tall ? 0 : undefined}
            aria-label={portrait && tall ? 'Scrollable screenshot' : undefined}
          >
            <img
              key={src}
              src={src}
              alt={caption}
              loading="lazy"
              onError={() => setFailed(src)}
              onLoad={(e) => {
                const img = e.currentTarget;
                setTall(img.naturalHeight / img.naturalWidth > 2.3);
              }}
            />
          </div>
          {(kind === 'duoBook' || kind === 'duoLaptop') && <span className="shot__hinge" aria-hidden />}
          {portrait && tall && <span className="shot__scroll">Scroll inside</span>}
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
      const label = b.tone === 'privacy' ? 'Privacy' : b.tone === 'warning' ? 'Careful' : 'Tip';
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
          <h3 className="mini">By role</h3>
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
          <h3 className="mini">On your device</h3>
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
