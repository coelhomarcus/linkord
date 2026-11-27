import type { CSSProperties, ReactNode } from 'react';

const MARK_BODY = 'M508.2 396.1C497.5 387.5 474.9 243.3 426.5 242C362.7 240.4 202.7 317.3 179.2 379.3C165.8 414.8 180.7 463.1 197.6 494.9C239 573 293.4 446.2 314.3 418.3C358.4 359.1 369.4 411 371 428.2C371.3 432.2 369.9 433.9 366.4 435.9C246.5 505.6 203.7 612.9 198.8 747.3C198.7 750.8 197.2 752.9 193.7 753.2C178.2 754.5 160.8 744.9 144.4 748.7C99.9 759.1 153.9 823.4 166 847.2C167.6 850.4 166.8 853.2 163.7 854.8C150.6 861.4 130.2 862.6 157.9 902C199.8 961.6 275.4 1012 350 1013.5C358.7 1013.7 372.8 1011.5 377.8 1003.4C385.6 990.5 373.9 977.5 371.3 965.2C370.8 962.8 373.4 961.1 375.6 962C500.1 1010.1 566 1012.6 626.5 1012.6C687 1012.6 752.9 1010.1 877.4 962C879.6 961.1 882.2 962.8 881.7 965.2C879.1 977.5 867.4 990.5 875.2 1003.4C880.2 1011.5 894.3 1013.7 903 1013.5C977.6 1012 1053.2 961.6 1095.1 902C1122.8 862.6 1102.4 861.4 1089.3 854.8C1086.2 853.2 1085.4 850.4 1087 847.2C1099.1 823.4 1153.1 759.1 1108.6 748.7C1092.2 744.9 1074.8 754.5 1059.3 753.2C1055.8 752.9 1054.3 750.8 1054.2 747.2C1049.2 612.9 1006.4 505.5 886.5 435.9C883.1 433.9 881.7 432.2 882 428.2C883.6 411 894.6 359.1 938.7 418.3C959.6 446.2 1014 573 1055.4 494.9C1072.3 463.1 1087.2 414.8 1073.8 379.3C1050.3 317.3 890.3 240.4 826.5 242C781.9 243.2 759.2 366 747.5 391.8C746.4 394.2 743.2 394.2 741.6 392.1C727.7 374.8 707.6 349.5 690 343C679 339.3 673.9 353.3 672 371C671.7 373.1 669.2 374.2 667.5 372.9C637.4 348.6 596.6 311.3 566 296C552 291 543 310 538 345C536.3 362.5 538.3 376.1 537.9 387.9C537.7 391.8 536.4 393.6 532.8 394.8C525 397.4 512.7 399.7 508.2 396.1Z';

// The accent supplies the pigment for every scene. Mixing with the local
// surface keeps props visible in panels and dialogs in both light and dark themes.
const ACCENT = 'var(--color-accent-primary)';
const SURFACE = 'var(--surface-base, var(--color-surface-app))';
const tone = (amount: number, base: string) => `color-mix(in oklab, ${ACCENT} ${amount}%, ${base})`;

const PALETTE = {
  '--es-back': tone(23, SURFACE),
  '--es-obj': tone(29, SURFACE),
  '--es-front': tone(36, SURFACE),
  '--es-line': tone(54, SURFACE),
  '--es-detail': tone(77, SURFACE),
  '--es-bold': ACCENT,
  '--es-mid': tone(86, SURFACE),
  '--es-mascot': tone(84, 'white'),
  '--es-companion': tone(69, SURFACE),
  '--es-blush': tone(78, 'black'),
  '--es-face': tone(11, 'white'),
  '--es-ink': tone(29, 'black'),
} as CSSProperties;

const BACK = 'var(--es-back)';
const OBJ = 'var(--es-obj)';
const FRONT = 'var(--es-front)';
const LINE = 'var(--es-line)';
const DETAIL = 'var(--es-detail)';
const BOLD = 'var(--es-bold)';
const MID = 'var(--es-mid)';

const stroke = { stroke: LINE, strokeWidth: 1.5, strokeLinejoin: 'round' } as const;

/** The round backdrop every scene shares, so the set reads as one family around the mascot. */
function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" className={className} style={PALETTE}>
      <circle cx="80" cy="62" r="50" fill={BACK} />
      {children}
    </svg>
  );
}

const MASCOT = 'var(--es-mascot)';
const COMPANION = 'var(--es-companion)';
const FACE = 'var(--es-face)';
const INK = 'var(--es-ink)';
const BLUSH = 'var(--es-blush)';

/* The mascot is drawn in the logo's own coordinates (public/logo.svg) and
   placed with a nested viewport, so every scene shares one silhouette. */
const MARK_VIEWBOX = '127.1 242 998.8 771.5';
const MARK_RATIO = 771.5 / 998.8;
const EYES = [446, 807] as const;
const EYE_Y = 724;

type Eyes = 'open' | 'closed' | 'happy';

/** The Overcord mascot: `look` moves the pupils (in logo units, about ±30 across and ±50 down),
 * `mouth` adds a small smile or an "o". */
function Mascot({ x, y, width, color = MASCOT, eyes = 'open', look = [0, 0], mouth, blush = true }: {
  x: number;
  y: number;
  width: number;
  color?: string;
  eyes?: Eyes;
  look?: readonly [number, number];
  mouth?: 'smile' | 'o';
  blush?: boolean;
}) {
  const height = width * MARK_RATIO;
  const lid = { stroke: FACE, strokeWidth: 40, strokeLinecap: 'round', fill: 'none' } as const;
  return (
    <>
      <ellipse cx={x + width / 2} cy={y + height - 1} rx={width * 0.4} ry={3.5} fill={OBJ} />
      <svg x={x} y={y} width={width} height={height} viewBox={MARK_VIEWBOX} overflow="visible">
        <path d={MARK_BODY} fill={color} />
        {blush && <><ellipse cx="318" cy="866" rx="56" ry="30" fill={BLUSH} /><ellipse cx="935" cy="866" rx="56" ry="30" fill={BLUSH} /></>}
        {eyes === 'open' && EYES.map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy={EYE_Y} rx="74" ry="110" fill={FACE} />
            <ellipse cx={cx + look[0]} cy={EYE_Y + 12 + look[1]} rx="40" ry="48" fill={INK} />
            <circle cx={cx + look[0] + 16} cy={EYE_Y - 14 + look[1]} r="13" fill={FACE} />
          </g>
        ))}
        {eyes === 'closed' && <path d="M384 748q62 52 124 0M745 748q62 52 124 0" {...lid} />}
        {eyes === 'happy' && <path d="M384 770q62-80 124 0M745 770q62-80 124 0" {...lid} />}
        {mouth === 'smile' && <path d="M590 868q36 34 72 0" stroke={INK} strokeWidth="26" strokeLinecap="round" fill="none" />}
        {mouth === 'o' && <ellipse cx="626" cy="884" rx="24" ry="20" fill={INK} />}
      </svg>
    </>
  );
}

const heartAt = (cx: number, cy: number, r: number, fill = BOLD) => (
  <path
    d={`M${cx} ${cy + r * 0.9}C${cx - r * 1.5} ${cy + r * 0.05} ${cx - r * 0.95} ${cy - r * 1.05} ${cx} ${cy - r * 0.35}C${cx + r * 0.95} ${cy - r * 1.05} ${cx + r * 1.5} ${cy + r * 0.05} ${cx} ${cy + r * 0.9}z`}
    fill={fill}
  />
);

const SCENES = {
  people: (
    <>
      <Mascot x={18} y={52} width={74} look={[26, -12]} mouth="smile" />
      <Mascot x={94} y={66} width={52} color={COMPANION} look={[-26, -12]} mouth="smile" />
      {heartAt(91, 36, 9)}
      {heartAt(108, 22, 5, COMPANION)}
    </>
  ),
  filter: (
    <>
      <Mascot x={14} y={54} width={80} look={[30, -30]} mouth="o" />
      <path d="M98 40h40l-15 18v16l-10 6V58z" fill={FRONT} {...stroke} />
      <path d="M104 46h28" stroke={MID} strokeWidth="3" strokeLinecap="round" />
      <path d="M44 34a6 6 0 1 1 8 6c-2 1-2 2-2 4" fill="none" stroke={MID} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="49" r="1.6" fill={MID} />
    </>
  ),
  document: (
    <>
      <Mascot x={12} y={54} width={80} look={[30, -22]} />
      <g transform="rotate(8 118 60)">
        <rect x="100" y="34" width="36" height="48" rx="6" fill={FRONT} {...stroke} />
        <rect x="110" y="30" width="16" height="8" rx="3" fill={OBJ} {...stroke} />
        <rect x="107" y="47" width="22" height="4" rx="2" fill={DETAIL} />
        <rect x="107" y="56" width="16" height="4" rx="2" fill={LINE} />
        <rect x="107" y="65" width="19" height="4" rx="2" fill={LINE} />
      </g>
    </>
  ),
  servers: (
    <>
      <Mascot x={12} y={54} width={80} look={[30, -16]} mouth="smile" />
      <path d="M100 62l18-16 18 16v26h-36z" fill={FRONT} {...stroke} />
      <path d="M96 64l22-20 22 20" fill="none" stroke={BOLD} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="112" y="72" width="12" height="16" rx="3" fill={OBJ} {...stroke} />
      <path d="M128 34v-10l8 3-8 3" fill={BOLD} stroke={BOLD} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M128 34v14" stroke={DETAIL} strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  flag: (
    <>
      <Mascot x={14} y={54} width={80} eyes="happy" mouth="smile" />
      <path d="M110 26v70" stroke={DETAIL} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M112 28h28l-7 10 7 10h-28z" fill={MID} />
      <path d="M120 38l3.5 3.5 6.5-7" fill="none" stroke={FACE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  link: (
    <>
      <Mascot x={12} y={54} width={80} look={[30, -30]} mouth="o" />
      <rect x="94" y="40" width="30" height="16" rx="8" fill="none" stroke={DETAIL} strokeWidth="5" transform="rotate(-35 109 48)" />
      <rect x="112" y="54" width="30" height="16" rx="8" fill="none" stroke={BOLD} strokeWidth="5" transform="rotate(-35 127 62)" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type EmptyIllustrationName = keyof typeof SCENES;

export function EmptyIllustration({ name, className }: { name: EmptyIllustrationName; className?: string }) {
  return <Scene className={className}>{SCENES[name]}</Scene>;
}
