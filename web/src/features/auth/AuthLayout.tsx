import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { LinkordMark } from '@/shared/ui/LinkordMark';

// Where the backdrop's specks sit, in percent of the screen. Fixed rather than random so the screen
// looks the same on every load (and in screenshots).
const SPECKS: readonly { x: number; y: number; size: number; delay: number }[] = [
  { x: 6, y: 24, size: 6, delay: 0 }, { x: 14, y: 72, size: 5, delay: 1.2 }, { x: 22, y: 12, size: 4, delay: 2.1 },
  { x: 9, y: 88, size: 6, delay: 0.6 }, { x: 28, y: 46, size: 4, delay: 1.8 }, { x: 35, y: 8, size: 5, delay: 2.6 },
  { x: 41, y: 92, size: 4, delay: 0.9 }, { x: 52, y: 4, size: 5, delay: 1.5 }, { x: 58, y: 95, size: 6, delay: 2.3 },
  { x: 66, y: 10, size: 4, delay: 0.3 }, { x: 73, y: 84, size: 5, delay: 1.1 }, { x: 77, y: 18, size: 6, delay: 2.9 },
  { x: 84, y: 60, size: 4, delay: 0.7 }, { x: 88, y: 30, size: 5, delay: 1.9 }, { x: 93, y: 78, size: 6, delay: 2.4 },
  { x: 96, y: 14, size: 4, delay: 0.4 }, { x: 70, y: 48, size: 4, delay: 1.4 }, { x: 18, y: 36, size: 5, delay: 2.7 },
];

const SPARKLES: readonly { x: number; y: number; size: number; delay: number }[] = [
  { x: 15, y: 56, size: 22, delay: 0.5 }, { x: 32, y: 93, size: 28, delay: 1.6 }, { x: 69, y: 45, size: 18, delay: 2.2 },
  { x: 80, y: 76, size: 26, delay: 0.9 }, { x: 94, y: 30, size: 30, delay: 1.3 }, { x: 54, y: 89, size: 20, delay: 2.8 },
];

function Sparkle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c.7 6.4 5.6 11.3 12 12-6.4.7-11.3 5.6-12 12-.7-6.4-5.6-11.3-12-12C6.4 11.3 11.3 6.4 12 0Z" />
    </svg>
  );
}

/** The signed-out screens' backdrop: a gradient from the theme's accent, a starfield and the mark in
 * the corner. Under a phone's width it gives way to the card, which then fills the screen. */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="auth-backdrop relative isolate flex min-h-full items-start justify-center overflow-x-hidden sm:items-center sm:p-8 sm:pt-28 md:pt-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden max-sm:hidden">
        <span className="auth-orb absolute left-[4%] top-[30%] size-40" />
        <span className="auth-orb absolute right-[6%] top-[22%] size-24 opacity-60" />
        {SPECKS.map((speck) => (
          <span
            key={`${speck.x}-${speck.y}`}
            className="auth-twinkle absolute rounded-[1px] bg-white/70"
            style={{ left: `${speck.x}%`, top: `${speck.y}%`, width: speck.size, height: speck.size, animationDelay: `${speck.delay}s` }}
          />
        ))}
        {SPARKLES.map((sparkle) => (
          <span
            key={`${sparkle.x}-${sparkle.y}`}
            className="auth-twinkle absolute text-white/60"
            style={{ left: `${sparkle.x}%`, top: `${sparkle.y}%`, animationDelay: `${sparkle.delay}s` }}
          >
            <Sparkle size={sparkle.size} />
          </span>
        ))}
      </div>
      <div className="absolute left-8 top-8 flex items-center gap-2.5 text-white max-sm:hidden md:left-12 md:top-12">
        <LinkordMark className="h-7 w-auto" />
        <span className="text-heading font-extrabold tracking-tight">Linkord</span>
      </div>
      {children}
    </div>
  );
}

/** The card every signed-out step sits in. `wide` makes room for a second column beside the form. */
export function AuthCard({ wide = false, className, children }: { wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <main
      className={cn(
        'motion-modal animate-in fade-in-0 slide-in-from-bottom-2 w-full bg-surface-panel p-6 text-text-primary max-sm:min-h-full sm:rounded-lg sm:p-8 sm:shadow-[0_2px_10px_0_rgb(0_0_0/0.2)]',
        wide ? 'sm:max-w-120 md:max-w-196' : 'sm:max-w-120',
        className,
      )}
    >
      {children}
    </main>
  );
}

export { AuthHeading, AuthLink, PasswordToggle } from '@linkord/frontend-shared/auth/AuthControls';
