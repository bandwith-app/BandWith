import { useState } from 'react';
import type { Block, Role } from '../content/types';
import { SHOTS, ROLE_LABEL } from '../content';
import { Inline } from './inline';
import { DeviceGlyph, DEVICE_SHORT } from './devices';
import { AlertTriangle, Lock, Sparkles, Image as ImageIcon } from 'lucide-react';

export function RoleChip({ role, on = true }: { role: Role; on?: boolean }) {
  return <span className={`chip chip--${role}${on ? '' : ' chip--off'}`}>{ROLE_LABEL[role]}</span>;
}

function Shot({ id, caption }: { id: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  const [tall, setTall] = useState(false);
  const meta = SHOTS.get(id);
  const wide = meta?.viewport === 'tablet';
  return (
    <figure className={`shot${wide ? ' shot--wide' : ''}`}>
      {failed ? (
        <div className="shot__missing">
          <ImageIcon size={22} />
          <span>Screenshot coming: {id}</span>
        </div>
      ) : (
        <div className={`shot__frame${wide ? ' shot__frame--wide' : ''}`}>
          <div className="shot__screen" tabIndex={tall ? 0 : undefined} aria-label={tall ? 'Scrollable screenshot' : undefined}>
            <img
              src={`./shots/${id}.webp`}
              alt={caption}
              loading="lazy"
              onError={() => setFailed(true)}
              onLoad={(e) => {
                const img = e.currentTarget;
                setTall(!wide && img.naturalHeight / img.naturalWidth > 2.3);
              }}
            />
          </div>
          {tall && <span className="shot__scroll">Scroll inside</span>}
        </div>
      )}
      <figcaption>
        <Inline text={caption} />
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
      return <Shot id={b.id} caption={b.caption} />;
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
