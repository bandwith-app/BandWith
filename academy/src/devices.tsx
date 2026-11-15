import type { Device } from '../content/types';

export const DEVICE_LABEL: Record<Device, string> = {
  phone: 'iPhone & Android phone',
  phoneLand: 'Phone, landscape',
  tablet: 'iPad & tablets',
  duoClosed: 'Dual-screen, closed',
  duoBook: 'Dual-screen, Book',
  duoLaptop: 'Dual-screen, Laptop',
  duoLand: 'Dual-screen, open landscape',
  android: 'Android',
  web: 'Web browser',
};

export const DEVICE_SHORT: Record<Device, string> = {
  phone: 'Phone',
  phoneLand: 'Landscape',
  tablet: 'iPad',
  duoClosed: 'Duo closed',
  duoBook: 'Duo Book',
  duoLaptop: 'Duo Laptop',
  duoLand: 'Duo open',
  android: 'Android',
  web: 'Web',
};

/** Small outline drawings of each device or posture (24×24, currentColor). */
export function DeviceGlyph({ device, size = 22 }: { device: Device; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (device) {
    case 'phone':
    case 'android':
      body = (
        <>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" {...p} />
          <path d="M11 18.5h2" {...p} />
          {device === 'android' && <path d="M10 5.5h4" {...p} />}
        </>
      );
      break;
    case 'phoneLand':
      body = (
        <>
          <rect x="2.5" y="7" width="19" height="10" rx="2.5" {...p} />
          <path d="M18.5 11v2" {...p} />
        </>
      );
      break;
    case 'tablet':
      body = (
        <>
          <rect x="4" y="2.5" width="16" height="19" rx="2.5" {...p} />
          <path d="M11 18.5h2" {...p} />
        </>
      );
      break;
    case 'duoClosed':
      body = (
        <>
          <rect x="7" y="2.5" width="10" height="19" rx="2" {...p} />
          <path d="M14.5 5.5h.5" {...p} />
        </>
      );
      break;
    case 'duoBook':
      body = (
        <>
          <rect x="2.5" y="4" width="9" height="16" rx="1.6" {...p} />
          <rect x="12.5" y="4" width="9" height="16" rx="1.6" {...p} />
        </>
      );
      break;
    case 'duoLaptop':
      body = (
        <>
          <rect x="4" y="3" width="16" height="9" rx="1.6" {...p} />
          <path d="M3 21l1.5-7h15L21 21z" {...p} />
        </>
      );
      break;
    case 'duoLand':
      body = (
        <>
          <rect x="3" y="3" width="18" height="8.5" rx="1.6" {...p} />
          <rect x="3" y="12.5" width="18" height="8.5" rx="1.6" {...p} />
        </>
      );
      break;
    case 'web':
      body = (
        <>
          <rect x="2.5" y="4" width="19" height="14" rx="2" {...p} />
          <path d="M2.5 8h19M8 21h8" {...p} />
        </>
      );
      break;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}
