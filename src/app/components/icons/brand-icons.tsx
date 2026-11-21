import React from 'react';
import { IconProps } from './IconBase';
import { arc, axis, box, bouts, circle, dot, dotIcon, ellipse, seg } from './dots';
import { mainInstrument } from '@/lib/instruments';
import { CheckCheck, Music, Plus, MessageCircle, X, Calendar, Home } from './custom-icons';

/* ═══════════════════════════════════════════════════════════════════════════
   BandWith Dot Icons — app chrome, status & instruments.
   Third-party marks (Google, Apple, Spotify, Apple Music) at the bottom of
   this file stay exactly as their owners draw them.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Connection status: two jacks, plugged / unplugged ── */

const PLUG = `M9 2V5.5M15 2V5.5M6 9H18V11.5A6 6 0 0 1 6 11.5Z${dot(12, 21)}`;

/** Live connection: a plugged power jack. */
export const PlugsConnectedIcon = dotIcon('PlugsConnectedIcon', { d: PLUG });

/** Offline: the same jack, struck through. */
export const PlugsDisconnectedIcon = dotIcon('PlugsDisconnectedIcon', { d: `${PLUG}M3 3L21 21` });

/** Delivered/read ticks, drawn in the success colour. */
export const ChecksIcon: React.FC<IconProps> = ({ style, ...props }) => (
  <CheckCheck {...props} style={{ color: 'var(--success, currentColor)', ...style }} />
);

/* ── Bottom navigation ── */

export const IconHome = Home;
export const IconCalendar = Calendar;
export const IconMusic = Music;
export const IconPlus = Plus;
export const IconChat = MessageCircle;
export const IconClose = X;

export const IconSettings = dotIcon('IconSettings', {
  d: `M4 8H7.5M18.5 8H20${dot(4, 16)}M15 16H20`,
  solid: [
    [13, 8, 2],
    [10, 16, 2],
  ],
});

export const IconMenu = dotIcon('IconMenu', { d: `M4 6H20M4 12H20M4 18H13${dot(17, 18)}` });

/* ── Instruments ──
   One icon per canonical key of src/lib/instruments.ts. Trombone shares the
   trumpet (brass), double bass shares the cello (upright strings). */

const G = axis(8.6, 15.4, -45);
/** Acoustic guitar: figure-eight body on a 45° axis, sound hole, neck, headstock. */
export const InstrumentGuitar = dotIcon('InstrumentGuitar', {
  d: bouts(8.6, 15.4, -45, -2.6, 4.6, 2.4, 3.4) + seg(...G(6.6), ...G(12.6)),
  bold: seg(...G(14.2), ...G(16.2)),
  boldScale: 1.6,
  solid: [[...G(-1.6), 0.9]],
});

const B = axis(7.0, 17.0, -45);
/** Electric bass: slimmer offset body, two pickups, long neck, headstock. */
export const InstrumentBass = dotIcon('InstrumentBass', {
  d:
    bouts(7.0, 17.0, -45, -2.2, 4.3, 1.9, 3.0) +
    seg(...B(5.2), ...B(16.4)) +
    seg(...B(-3.2, -0.9), ...B(-3.2, 0.9)) +
    seg(...B(-1.0, -0.9), ...B(-1.0, 0.9)),
  bold: seg(...B(18.0), ...B(20.0)),
  boldScale: 1.6,
});

/** Drums: a snare with crossed sticks. */
export const InstrumentDrums = dotIcon('InstrumentDrums', {
  d:
    ellipse(12, 11, 8, 3) +
    'M4 11V16.5M20 11V16.5' +
    arc(12, 16.5, 8, 0, 180).replace(/A8 8/, 'A8 3') +
    seg(5, 2.6, 9.6, 5.6) +
    seg(19, 2.6, 14.4, 5.6) +
    dot(8, 15.6, 12, 16.4, 16, 15.6),
});

/** Vocals: handheld mic (ball head, handle) and one voice arc. */
export const InstrumentVocals = dotIcon('InstrumentVocals', {
  d: seg(11.6, 12.4, 5.4, 18.6) + dot(3.6, 20.4) + arc(15, 9, 6.6, -78, -12),
  solid: [[15, 9, 2.7]],
});

/** Keys: open-corner keyboard, black keys (2 + 1), white-key dots. */
export const InstrumentKeys = dotIcon('InstrumentKeys', {
  d: box(2.5, 5, 19, 14) + dot(6.3, 16, 10.1, 16, 13.9, 16, 17.7, 16),
  bold: 'M6.3 9.2V11.4M10.1 9.2V11.4M17.7 9.2V11.4',
  boldScale: 1.4,
});

/** Sax: neck and mouthpiece, body with the U-turn, flared bell, key dots. */
export const InstrumentSax = dotIcon('InstrumentSax', {
  d: `M5 3.2L8.6 5.6M9.6 7.8V15.2A4.2 4.2 0 0 0 18 15.2V11.6M15.6 9.2H20.4${dot(12.6, 9.8, 12.6, 13.2)}`,
});

/** Trumpet (and the brass section): mouthpiece, lead pipe, three valves, bell. */
export const InstrumentTrumpet = dotIcon('InstrumentTrumpet', {
  d: `${dot(2.5, 13)}M5 13H15M17 11.2Q19.6 10.4 21.5 7.6V18.4Q19.6 15.6 17 14.8M7.4 8.4V10M10.4 8.4V10M13.4 8.4V10`,
});

/** Violin: hourglass body, f-hole dots, neck, and the bow beside it. */
export const InstrumentViolin = dotIcon('InstrumentViolin', {
  d: bouts(10.2, 14.6, 90, -3.2, 3.2, 2.6, 4.2) + seg(10.2, 7.8, 10.2, 2.6) + dot(8.6, 17.8, 11.8, 17.8) + seg(19.6, 3, 16.4, 21),
});

/** Cello and double bass: big upright body, neck, f-hole dots. */
export const InstrumentCello = dotIcon('InstrumentCello', {
  d: bouts(12, 12.6, 90, -3.2, 3.6, 3.2, 4.8) + seg(12, 5.4, 12, 2.4) + dot(10.3, 16.6, 13.7, 16.6),
});

/** Percussion: a pair of bongos. */
export const InstrumentPercussion = dotIcon('InstrumentPercussion', {
  d:
    ellipse(7.5, 9, 4.5, 1.8) +
    'M3 9V15.5A4.5 1.8 0 0 0 12 15.5V9' +
    ellipse(17.6, 11, 3.6, 1.5) +
    'M14 11V16.4A3.6 1.5 0 0 0 21.2 16.4V11' +
    dot(13, 19.6),
});

/** DJ: open-corner deck, platter with centre disc, tone arm. */
export const InstrumentDJ = dotIcon('InstrumentDJ', {
  d: box(2.5, 4, 19, 16) + circle(10, 12, 4.6) + 'M17.6 7.2V13.6L15.6 15.6',
  solid: [[10, 12, 0.9]],
});

/** Any other instrument: an eighth note. */
export const InstrumentOther = dotIcon('InstrumentOther', {
  d: 'M11.2 17V3.6C13.6 4.4 16.4 6 16.6 9.4',
  solid: [[8.4, 17.4, 2.2]],
});

/** Icon key → icon. */
export const INSTRUMENT_ICONS = {
  guitar: InstrumentGuitar,
  bass: InstrumentBass,
  drums: InstrumentDrums,
  vocals: InstrumentVocals,
  keys: InstrumentKeys,
  sax: InstrumentSax,
  trumpet: InstrumentTrumpet,
  violin: InstrumentViolin,
  cello: InstrumentCello,
  percussion: InstrumentPercussion,
  dj: InstrumentDJ,
  other: InstrumentOther,
} as const;

export type InstrumentIconKey = keyof typeof INSTRUMENT_ICONS;

/** Canonical instrument (src/lib/instruments.ts) → the icon that draws it. */
const ICON_FOR: Record<string, InstrumentIconKey> = {
  guitar: 'guitar',
  bass: 'bass',
  'double-bass': 'cello',
  drums: 'drums',
  percussion: 'percussion',
  vocals: 'vocals',
  keys: 'keys',
  sax: 'sax',
  trumpet: 'trumpet',
  trombone: 'trumpet',
  violin: 'violin',
  cello: 'cello',
  dj: 'dj',
  // Older generic ids.
  brass: 'trumpet',
  horns: 'trumpet',
  strings: 'violin',
  turntable: 'dj',
  turntables: 'dj',
};

/**
 * The icon for an instrument id or free-text field ("saxophone",
 * "Bass · Band leader", "Contrabbasso"): its main instrument, or 'other'.
 */
export const instrumentIconKey = (text: string | null | undefined): InstrumentIconKey => {
  const key = mainInstrument(text);
  return (key && ICON_FOR[key]) || 'other';
};

/** The Dot Icon for an instrument id or free-text instrument field. */
export const InstrumentIcon: React.FC<IconProps & { instrumentId: string | null | undefined }> = ({
  instrumentId,
  ...props
}) => {
  const key = instrumentIconKey(instrumentId);
  const Icon = INSTRUMENT_ICONS[key];
  return <Icon data-instrument={key} {...props} />;
};

/* ── Third-Party OAuth & Music Streaming Marks ── */

/** Official Google "G" (logo_googleg_48dp, Google Sign-In branding assets). Keep the four colours. */
export const GoogleBrandIcon: React.FC<IconProps> = ({ size = 20, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="-1 0 120 120"
    aria-hidden={props['aria-label'] ? undefined : true}
    className={className}
    {...props}
  >
    <path fill="#4285F4" d="M117.6,61.3636364 C117.6,57.1090909 117.218182,53.0181818 116.509091,49.0909091 L60,49.0909091 L60,72.3 L92.2909091,72.3 C90.9,79.8 86.6727273,86.1545455 80.3181818,90.4090909 L80.3181818,105.463636 L99.7090909,105.463636 C111.054545,95.0181818 117.6,79.6363636 117.6,61.3636364 L117.6,61.3636364 Z" />
    <path fill="#34A853" d="M60,120 C76.2,120 89.7818182,114.627273 99.7090909,105.463636 L80.3181818,90.4090909 C74.9454545,94.0090909 68.0727273,96.1363636 60,96.1363636 C44.3727273,96.1363636 31.1454545,85.5818182 26.4272727,71.4 L6.38181818,71.4 L6.38181818,86.9454545 C16.2545455,106.554545 36.5454545,120 60,120 L60,120 Z" />
    <path fill="#FBBC05" d="M26.4272727,71.4 C25.2272727,67.8 24.5454545,63.9545455 24.5454545,60 C24.5454545,56.0454545 25.2272727,52.2 26.4272727,48.6 L26.4272727,33.0545455 L6.38181818,33.0545455 C2.31818182,41.1545455 0,50.3181818 0,60 C0,69.6818182 2.31818182,78.8454545 6.38181818,86.9454545 L26.4272727,71.4 L26.4272727,71.4 Z" />
    <path fill="#EA4335" d="M60,23.8636364 C68.8090909,23.8636364 76.7181818,26.8909091 82.9363636,32.8363636 L100.145455,15.6272727 C89.7545455,5.94545455 76.1727273,0 60,0 C36.5454545,0 16.2545455,13.4454545 6.38181818,33.0545455 L26.4272727,48.6 C31.1454545,34.4181818 44.3727273,23.8636364 60,23.8636364 L60,23.8636364 Z" />
  </svg>
);

/** Official Apple logo, as drawn by Apple's Sign in with Apple JS button. Single colour (currentColor). */
export const AppleBrandIcon: React.FC<IconProps> = ({ size = 20, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="18.5 16 19 19"
    fill="currentColor"
    aria-hidden={props['aria-label'] ? undefined : true}
    className={className}
    {...props}
  >
    <path fillRule="nonzero" d="M28.2226562,20.3846154 C29.0546875,20.3846154 30.0976562,19.8048315 30.71875,19.0317864 C31.28125,18.3312142 31.6914062,17.352829 31.6914062,16.3744437 C31.6914062,16.2415766 31.6796875,16.1087095 31.65625,16 C30.7304687,16.0362365 29.6171875,16.640178 28.9492187,17.4494596 C28.421875,18.06548 27.9414062,19.0317864 27.9414062,20.0222505 C27.9414062,20.1671964 27.9648438,20.3121424 27.9765625,20.3604577 C28.0351562,20.3725366 28.1289062,20.3846154 28.2226562,20.3846154 Z M25.2929688,35 C26.4296875,35 26.9335938,34.214876 28.3515625,34.214876 C29.7929688,34.214876 30.109375,34.9758423 31.375,34.9758423 C32.6171875,34.9758423 33.4492188,33.792117 34.234375,32.6325493 C35.1132812,31.3038779 35.4765625,29.9993643 35.5,29.9389701 C35.4179688,29.9148125 33.0390625,28.9122695 33.0390625,26.0979021 C33.0390625,23.6579784 34.9140625,22.5588048 35.0195312,22.474253 C33.7773438,20.6382708 31.890625,20.5899555 31.375,20.5899555 C29.9804688,20.5899555 28.84375,21.4596313 28.1289062,21.4596313 C27.3554688,21.4596313 26.3359375,20.6382708 25.1289062,20.6382708 C22.8320312,20.6382708 20.5,22.5950413 20.5,26.2911634 C20.5,28.5861411 21.3671875,31.013986 22.4335938,32.5842339 C23.3476562,33.9129053 24.1445312,35 25.2929688,35 Z" />
  </svg>
);

export const SpotifyBrandIcon: React.FC<IconProps> = ({ size = 24, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden={props['aria-label'] ? undefined : true}
    className={className}
    {...props}
  >
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

export const AppleMusicBrandIcon: React.FC<IconProps> = ({ size = 24, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden={props['aria-label'] ? undefined : true}
    className={className}
    {...props}
  >
    <path d="M16.5 3.25a.75.75 0 0 1 .94-.72l.06.02v12.2a3.25 3.25 0 1 1-1.5-2.73V7.3l-7 1.55v7.9a3.25 3.25 0 1 1-1.5-2.73V5.4a.75.75 0 0 1 .59-.73l8-1.78a.75.75 0 0 1 .41.36Z" />
  </svg>
);
