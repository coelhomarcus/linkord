import type { CSSProperties, ReactNode } from 'react';

/* Every colour is mixed against the surface the illustration sits on
   (`--surface-base`, set by the shell, panels and modals) instead of a fixed
   grey: the Black theme paints every surface #000, so a fixed fill would vanish
   there while it reads fine on Old and Discord. Solid mixes (not alpha) keep
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
  '--es-on-accent': 'var(--color-text-strong)',
} as CSSProperties;

const BACK = 'var(--es-back)';
const OBJ = 'var(--es-obj)';
const FRONT = 'var(--es-front)';
const LINE = 'var(--es-line)';
const DETAIL = 'var(--es-detail)';
const ACCENT = 'var(--es-accent)';
const ACCENT_SOFT = 'var(--es-accent-soft)';
const ON_ACCENT = 'var(--es-on-accent)';

const stroke = { stroke: LINE, strokeWidth: 1.5, strokeLinejoin: 'round' } as const;

/** The round backdrop and the scattered sparkles every scene shares, so the set reads as one family. */
function Scene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" className={className} style={TOKENS}>
      <circle cx="80" cy="62" r="50" fill={BACK} />
      <path d="M27 30v8M23 34h8" stroke={ACCENT_SOFT} strokeWidth="2" strokeLinecap="round" />
      <circle cx="136" cy="34" r="3" fill={DETAIL} />
      <circle cx="128" cy="100" r="2.5" fill={ACCENT_SOFT} />
      <circle cx="30" cy="92" r="2" fill={DETAIL} />
      {children}
    </svg>
  );
}

/** A small accent disc with a glyph inside: the one spot of colour in a scene. */
function Badge({ cx, cy, children }: { cx: number; cy: number; children: ReactNode }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="11" fill={ACCENT} stroke={BASE} strokeWidth="3" />
      <g stroke={ON_ACCENT} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" fill="none">{children}</g>
    </g>
  );
}

const plusAt = (x: number, y: number) => <path d={`M${x} ${y - 4.5}v9M${x - 4.5} ${y}h9`} />;
const checkAt = (x: number, y: number) => <path d={`M${x - 4.5} ${y}l3 3 6-6.5`} />;

const SCENES = {
  people: (
    <>
      <circle cx="100" cy="46" r="10" fill={OBJ} {...stroke} />
      <path d="M82 86a18 18 0 0 1 36 0v4H82z" fill={OBJ} {...stroke} />
      <circle cx="70" cy="52" r="13" fill={FRONT} {...stroke} />
      <path d="M46 96a24 24 0 0 1 48 0v2H46z" fill={FRONT} {...stroke} />
      <Badge cx={112} cy={82}>{plusAt(112, 82)}</Badge>
    </>
  ),
  person: (
    <>
      <circle cx="80" cy="48" r="14" fill={FRONT} {...stroke} />
      <path d="M54 96a26 26 0 0 1 52 0v2H54z" fill={FRONT} {...stroke} />
      <circle cx="94" cy="60" r="6" fill={BASE} stroke={DETAIL} strokeWidth="3" />
      <path d="M108 32h8l-8 9h8M118 22h5l-5 6h5" stroke={DETAIL} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  mail: (
    <>
      <rect x="44" y="42" width="72" height="50" rx="8" fill={FRONT} {...stroke} />
      <path d="M47 47l33 23 33-23" fill="none" stroke={DETAIL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M108 30l20-8-8 20-4-8z" fill={ACCENT} />
      <path d="M100 38c-3 3-5 4-9 4" fill="none" stroke={ACCENT_SOFT} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 4" />
    </>
  ),
  shield: (
    <>
      <path d="M80 26l32 11v24c0 21-14 35-32 42-18-7-32-21-32-42V37z" fill={FRONT} {...stroke} />
      <path d="M80 36l22 8v17c0 15-9 25-22 31z" fill={OBJ} />
      <Badge cx={80} cy={62}>{checkAt(80, 62)}</Badge>
    </>
  ),
  speaker: (
    <>
      <rect x="46" y="50" width="16" height="22" rx="4" fill={OBJ} {...stroke} />
      <path d="M62 52l20-16v50L62 70z" fill={FRONT} {...stroke} />
      <path d="M93 50a15 15 0 0 1 0 22" fill="none" stroke={DETAIL} strokeWidth="3" strokeLinecap="round" />
      <path d="M102 41a28 28 0 0 1 0 40" fill="none" stroke={ACCENT_SOFT} strokeWidth="3" strokeLinecap="round" />
      <path d="M111 33a40 40 0 0 1 0 56" fill="none" stroke={ACCENT_SOFT} strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" />
    </>
  ),
  chat: (
    <>
      <path d="M78 30h34a12 12 0 0 1 12 12v12a12 12 0 0 1-12 12h-2v9l-10-9H78a12 12 0 0 1-12-12V42a12 12 0 0 1 12-12z" fill={OBJ} {...stroke} />
      <path d="M48 52h36a12 12 0 0 1 12 12v14a12 12 0 0 1-12 12H62l-12 10V90h-2a12 12 0 0 1-12-12V64a12 12 0 0 1 12-12z" fill={FRONT} {...stroke} />
      <circle cx="54" cy="71" r="3.5" fill={DETAIL} />
      <circle cx="66" cy="71" r="3.5" fill={DETAIL} />
      <circle cx="78" cy="71" r="3.5" fill={ACCENT} />
    </>
  ),
  bubble: (
    <>
      <path d="M52 34h56a14 14 0 0 1 14 14v20a14 14 0 0 1-14 14H76l-16 14V82h-8a14 14 0 0 1-14-14V48a14 14 0 0 1 14-14z" fill={FRONT} {...stroke} />
      <rect x="52" y="50" width="44" height="6" rx="3" fill={DETAIL} />
      <rect x="52" y="62" width="28" height="6" rx="3" fill={LINE} />
      <path d="M118 22l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={ACCENT} />
    </>
  ),
  search: (
    <>
      <path d="M93 74l17 17" stroke={DETAIL} strokeWidth="9" strokeLinecap="round" />
      <circle cx="74" cy="56" r="25" fill={FRONT} {...stroke} />
      <circle cx="74" cy="56" r="17" fill={OBJ} />
      <path d="M64 48a12 12 0 0 1 10-5" fill="none" stroke={DETAIL} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  filter: (
    <>
      <path d="M44 36h72l-27 32v20l-18 10V68z" fill={FRONT} {...stroke} />
      <path d="M56 46h48" stroke={DETAIL} strokeWidth="3" strokeLinecap="round" />
      <Badge cx={110} cy={84}><path d="M106 80l8 8M114 80l-8 8" /></Badge>
    </>
  ),
  document: (
    <>
      <rect x="52" y="30" width="56" height="70" rx="8" fill={FRONT} {...stroke} />
      <rect x="67" y="24" width="26" height="12" rx="4" fill={OBJ} {...stroke} />
      <rect x="62" y="50" width="36" height="5" rx="2.5" fill={DETAIL} />
      <rect x="62" y="62" width="28" height="5" rx="2.5" fill={LINE} />
      <rect x="62" y="74" width="32" height="5" rx="2.5" fill={LINE} />
      <Badge cx={108} cy={90}>{checkAt(108, 90)}</Badge>
    </>
  ),
  wall: (
    <>
      <rect x="44" y="30" width="34" height="28" rx="6" fill={FRONT} {...stroke} />
      <rect x="84" y="30" width="34" height="40" rx="6" fill={OBJ} {...stroke} />
      <rect x="44" y="64" width="34" height="32" rx="6" fill={OBJ} {...stroke} />
      <rect x="84" y="76" width="34" height="20" rx="6" fill="none" stroke={ACCENT_SOFT} strokeWidth="2" strokeDasharray="4 4" />
      <path d="M101 81v10M96 86h10" stroke={ACCENT} strokeWidth="2.25" strokeLinecap="round" />
      <rect x="50" y="38" width="16" height="4" rx="2" fill={DETAIL} />
    </>
  ),
  bell: (
    <>
      <path d="M80 30c-14 0-24 11-24 25v16l-7 10h62l-7-10V55c0-14-10-25-24-25z" fill={FRONT} {...stroke} />
      <path d="M72 86a8 8 0 0 0 16 0z" fill={DETAIL} />
      <rect x="76" y="24" width="8" height="8" rx="4" fill={DETAIL} />
      <Badge cx={104} cy={42}>{checkAt(104, 42)}</Badge>
    </>
  ),
  hash: (
    <>
      <rect x="48" y="30" width="64" height="64" rx="18" fill={FRONT} {...stroke} />
      <path d="M72 46l-4 32M90 46l-4 32M62 56h34M60 68h34" stroke={DETAIL} strokeWidth="5" strokeLinecap="round" />
      <Badge cx={110} cy={90}>{plusAt(110, 90)}</Badge>
    </>
  ),
  servers: (
    <>
      <rect x="62" y="22" width="36" height="24" rx="10" fill={OBJ} {...stroke} />
      <rect x="62" y="50" width="36" height="24" rx="10" fill={FRONT} {...stroke} />
      <rect x="62" y="78" width="36" height="24" rx="10" fill={OBJ} {...stroke} />
      <circle cx="72" cy="62" r="3.5" fill={ACCENT} />
      <rect x="80" y="60" width="12" height="4" rx="2" fill={DETAIL} />
    </>
  ),
  flag: (
    <>
      <path d="M56 28v72" stroke={DETAIL} strokeWidth="5" strokeLinecap="round" />
      <path d="M58 32h46l-9 14 9 14H58z" fill={FRONT} {...stroke} />
      <Badge cx={106} cy={86}>{checkAt(106, 86)}</Badge>
    </>
  ),
  link: (
    <>
      <rect x="38" y="48" width="48" height="26" rx="13" fill={OBJ} {...stroke} transform="rotate(-30 62 61)" />
      <rect x="74" y="48" width="48" height="26" rx="13" fill={FRONT} {...stroke} transform="rotate(-30 98 61)" />
      <path d="M72 70l16-18" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type EmptyIllustrationName = keyof typeof SCENES;

export function EmptyIllustration({ name, className }: { name: EmptyIllustrationName; className?: string }) {
  return <Scene className={className}>{SCENES[name]}</Scene>;
}
