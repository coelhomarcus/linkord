import type { CSSProperties, ReactNode } from 'react';

import { MARK_BODY } from './OvercordMark';

/* Every colour is mixed against the surface the illustration sits on
   (`--surface-base`, set by the shell, panels and modals) instead of a fixed
   grey: the Black theme paints every surface #000, so a fixed fill would vanish
   there while it reads fine on Old and Graphite. Solid mixes (not alpha) keep
   overlapping shapes from showing through each other. */
const BASE = 'var(--surface-base, var(--color-surface-app))';
const mix = (color: string, amount: number) => `color-mix(in oklab, ${color} ${amount}%, ${BASE})`;

const TOKENS = {
  '--es-back': mix('var(--color-text-primary)', 8),
  '--es-obj': mix('var(--color-text-primary)', 14),
  '--es-front': mix('var(--color-text-primary)', 21),
  '--es-line': mix('var(--color-text-primary)', 30),
  '--es-detail': mix('var(--color-text-primary)', 44),
  '--es-accent': 'var(--color-accent-primary)',
  '--es-accent-soft': mix('var(--color-accent-primary)', 55),
  /* the mascot keeps its own colours on every theme: it is the logo, and the
     logo takes the theme's colour only where a theme repaints `--color-logo` */
  '--es-mascot': 'var(--color-logo)',
  '--es-friend': 'oklch(76% 0.12 355)',
  '--es-heart': 'oklch(66% 0.2 15)',
  '--es-gold': 'oklch(80% 0.14 78)',
  '--es-white': '#fff',
  '--es-pupil': 'oklch(24% 0.04 255)',
  '--es-blush': 'oklch(72% 0.14 10 / 0.55)',
} as CSSProperties;

const BACK = 'var(--es-back)';
const OBJ = 'var(--es-obj)';
const FRONT = 'var(--es-front)';
const LINE = 'var(--es-line)';
const DETAIL = 'var(--es-detail)';
const ACCENT = 'var(--es-accent)';
const ACCENT_SOFT = 'var(--es-accent-soft)';

const stroke = { stroke: LINE, strokeWidth: 1.5, strokeLinejoin: 'round' } as const;

/** The round backdrop every scene shares, so the set reads as one family around the mascot. */
function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" className={className} style={TOKENS}>
      <circle cx="80" cy="62" r="50" fill={BACK} />
      {children}
    </svg>
  );
}

const MASCOT = 'var(--es-mascot)';
const FRIEND = 'var(--es-friend)';
const HEART = 'var(--es-heart)';
const GOLD = 'var(--es-gold)';
const WHITE = 'var(--es-white)';
const PUPIL = 'var(--es-pupil)';
const BLUSH = 'var(--es-blush)';

/* The mascot is drawn in the logo's own coordinates (public/logo.svg) and
   placed with a nested viewport, so every scene shares one silhouette. */
const MARK_VIEWBOX = '127.1 242 998.8 771.5';
const MARK_RATIO = 771.5 / 998.8;
const EYES = [446, 807] as const;
const EYE_Y = 724;

type Eyes = 'open' | 'closed' | 'happy';

/** The Overcord mascot: `look` moves the pupils (in logo units, about ±30 across and ±50 down),
 * `mouth` adds a small smile or an "o", `flip` turns it to face the other way. */
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
  const lid = { stroke: WHITE, strokeWidth: 40, strokeLinecap: 'round', fill: 'none' } as const;
  return (
    <>
      <ellipse cx={x + width / 2} cy={y + height - 1} rx={width * 0.4} ry={3.5} fill={OBJ} />
      <svg x={x} y={y} width={width} height={height} viewBox={MARK_VIEWBOX} overflow="visible">
        <path d={MARK_BODY} fill={color} />
        {blush && <><ellipse cx="318" cy="866" rx="56" ry="30" fill={BLUSH} /><ellipse cx="935" cy="866" rx="56" ry="30" fill={BLUSH} /></>}
        {eyes === 'open' && EYES.map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy={EYE_Y} rx="74" ry="110" fill={WHITE} />
            <ellipse cx={cx + look[0]} cy={EYE_Y + 12 + look[1]} rx="40" ry="48" fill={PUPIL} />
            <circle cx={cx + look[0] + 16} cy={EYE_Y - 14 + look[1]} r="13" fill={WHITE} />
          </g>
        ))}
        {eyes === 'closed' && <path d="M384 748q62 52 124 0M745 748q62 52 124 0" {...lid} />}
        {eyes === 'happy' && <path d="M384 770q62-80 124 0M745 770q62-80 124 0" {...lid} />}
        {mouth === 'smile' && <path d="M590 868q36 34 72 0" stroke={PUPIL} strokeWidth="26" strokeLinecap="round" fill="none" />}
        {mouth === 'o' && <ellipse cx="626" cy="884" rx="24" ry="20" fill={PUPIL} />}
      </svg>
    </>
  );
}

const heartAt = (cx: number, cy: number, r: number, fill = HEART) => (
  <path
    d={`M${cx} ${cy + r * 0.9}C${cx - r * 1.5} ${cy + r * 0.05} ${cx - r * 0.95} ${cy - r * 1.05} ${cx} ${cy - r * 0.35}C${cx + r * 0.95} ${cy - r * 1.05} ${cx + r * 1.5} ${cy + r * 0.05} ${cx} ${cy + r * 0.9}z`}
    fill={fill}
  />
);

/* The speech bubble the conversation scenes share, above the mascot's right ear. */
const SPEECH = 'M100 22h30a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8h-20l-12 9 2-9a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z';

const SCENES = {
  people: (
    <>
      <Mascot x={18} y={52} width={74} look={[26, -12]} mouth="smile" />
      <Mascot x={94} y={66} width={52} color={FRIEND} look={[-26, -12]} mouth="smile" />
      {heartAt(91, 36, 9)}
      {heartAt(108, 22, 5, FRIEND)}
    </>
  ),
  person: (
    <>
      <Mascot x={30} y={50} width={84} look={[-28, -30]} mouth="o" />
      <path d="M128 22a12 12 0 1 0 8 20a10 10 0 0 1-8-20z" fill={GOLD} />
      <path d="M112 20l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill={GOLD} />
    </>
  ),
  mail: (
    <>
      <Mascot x={22} y={52} width={76} look={[28, -44]} mouth="o" />
      <g transform="rotate(-10 113 39)">
        <rect x="92" y="24" width="42" height="30" rx="5" fill={FRONT} {...stroke} />
        <path d="M95 27l18 13 18-13" fill="none" stroke={DETAIL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {heartAt(113, 42, 6)}
      </g>
    </>
  ),
  shield: (
    <>
      <Mascot x={14} y={52} width={80} eyes="happy" mouth="smile" />
      <path d="M118 40l20 7v15c0 14-9 23-20 28-11-5-20-14-20-28V47z" fill={FRONT} {...stroke} />
      <path d="M110 64l6 6 11-12" fill="none" stroke={ACCENT} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  speaker: (
    <>
      <Mascot x={30} y={50} width={84} eyes="happy" mouth="smile" />
      <ellipse cx="117" cy="44" rx="5" ry="4" fill={ACCENT} transform="rotate(-20 117 44)" />
      <path d="M121.5 43V24q8 2 9 10" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="134" cy="56" rx="3.5" ry="2.8" fill={ACCENT_SOFT} transform="rotate(-20 134 56)" />
      <path d="M137 55.5V42" stroke={ACCENT_SOFT} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  chat: (
    <>
      <Mascot x={22} y={54} width={76} look={[28, -40]} />
      <path d={SPEECH} fill={FRONT} {...stroke} />
      <circle cx="105" cy="38" r="3.5" fill={DETAIL} />
      <circle cx="115" cy="38" r="3.5" fill={DETAIL} />
      <circle cx="125" cy="38" r="3.5" fill={ACCENT} />
    </>
  ),
  bubble: (
    <>
      <Mascot x={22} y={54} width={76} eyes="happy" mouth="smile" />
      <path d={SPEECH} fill={FRONT} {...stroke} />
      {heartAt(115, 38, 8)}
    </>
  ),
  search: (
    <>
      <Mascot x={16} y={52} width={80} look={[30, -6]} />
      <path d="M125 83l13 14" stroke={DETAIL} strokeWidth="7" strokeLinecap="round" />
      <circle cx="114" cy="71" r="16" fill={FRONT} stroke={GOLD} strokeWidth="5" />
      <path d="M106 66a9 9 0 0 1 7-5" fill="none" stroke={WHITE} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
    </>
  ),
  filter: (
    <>
      <Mascot x={14} y={54} width={80} look={[30, -30]} mouth="o" />
      <path d="M98 40h40l-15 18v16l-10 6V58z" fill={FRONT} {...stroke} />
      <path d="M104 46h28" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M44 34a6 6 0 1 1 8 6c-2 1-2 2-2 4" fill="none" stroke={ACCENT_SOFT} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="49" r="1.6" fill={ACCENT_SOFT} />
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
  wall: (
    <>
      <Mascot x={38} y={50} width={84} look={[0, -46]} mouth="smile" />
      <g transform="rotate(-10 44 34)">
        <rect x="32" y="22" width="24" height="22" rx="3" fill={GOLD} />
        <rect x="37" y="29" width="14" height="3" rx="1.5" fill={WHITE} opacity="0.7" />
      </g>
      <g transform="rotate(8 118 30)">
        <rect x="106" y="18" width="24" height="22" rx="3" fill={FRIEND} />
        {heartAt(118, 29, 5, WHITE)}
      </g>
      <rect x="70" y="10" width="20" height="18" rx="3" fill="none" stroke={ACCENT_SOFT} strokeWidth="1.75" strokeDasharray="3 3" />
      <path d="M80 15v8M76 19h8" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  bell: (
    <>
      <Mascot x={36} y={44} width={88} eyes="closed" mouth="o" />
      <path d="M114 32h9l-9 10h9M128 18h6l-6 7h6" stroke={ACCENT_SOFT} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  hash: (
    <>
      <Mascot x={22} y={54} width={76} eyes="happy" mouth="smile" />
      <path d={SPEECH} fill={FRONT} {...stroke} />
      <path d="M112 31l-2 14M121 31l-2 14M107 35h16M106 41h16" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  servers: (
    <>
      <Mascot x={12} y={54} width={80} look={[30, -16]} mouth="smile" />
      <path d="M100 62l18-16 18 16v26h-36z" fill={FRONT} {...stroke} />
      <path d="M96 64l22-20 22 20" fill="none" stroke={ACCENT} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="112" y="72" width="12" height="16" rx="3" fill={OBJ} {...stroke} />
      <path d="M128 34v-10l8 3-8 3" fill={HEART} stroke={HEART} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M128 34v14" stroke={DETAIL} strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  flag: (
    <>
      <Mascot x={14} y={54} width={80} eyes="happy" mouth="smile" />
      <path d="M110 26v70" stroke={DETAIL} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M112 28h28l-7 10 7 10h-28z" fill={GOLD} />
      <path d="M120 38l3.5 3.5 6.5-7" fill="none" stroke={WHITE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  link: (
    <>
      <Mascot x={12} y={54} width={80} look={[30, -30]} mouth="o" />
      <rect x="94" y="40" width="30" height="16" rx="8" fill="none" stroke={DETAIL} strokeWidth="5" transform="rotate(-35 109 48)" />
      <rect x="112" y="54" width="30" height="16" rx="8" fill="none" stroke={ACCENT} strokeWidth="5" transform="rotate(-35 127 62)" />
    </>
  ),
  pin: (
    <>
      <Mascot x={14} y={54} width={80} look={[30, -26]} mouth="smile" />
      <g transform="rotate(18 120 56)">
        <rect x="111" y="28" width="18" height="8" rx="3" fill={HEART} />
        <path d="M114 36h12l-2 13 7 7v4h-22v-4l7-7z" fill={HEART} />
        <path d="M120 60v22" stroke={DETAIL} strokeWidth="2.5" strokeLinecap="round" />
        <rect x="116" y="38" width="3" height="10" rx="1.5" fill={WHITE} opacity="0.5" />
      </g>
    </>
  ),
  bookmark: (
    <>
      <Mascot x={12} y={54} width={80} eyes="happy" mouth="smile" />
      <path d="M102 28h28v54l-14-10-14 10z" fill={GOLD} />
      <path d="M116 38l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill={WHITE} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type EmptyIllustrationName = keyof typeof SCENES;

export function EmptyIllustration({ name, className }: { name: EmptyIllustrationName; className?: string }) {
  return <Scene className={className}>{SCENES[name]}</Scene>;
}
