import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { DesktopWindowControls, DesktopWindowState } from '@/shared/desktop';
import { titleBarStyle, useDesktopWindowState } from '@/app/layout/titleBar';

// Windows 11's caption glyphs (Segoe Fluent Icons' ChromeMinimize, ChromeMaximize,
// ChromeRestore, ChromeClose): 10 px, hairline strokes
function FluentGlyph({ children }: { children: ReactNode }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      {children}
    </svg>
  );
}

// GNOME's symbolic window icons (libadwaita), drawn at the size its round buttons show them
function AdwaitaGlyph({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

interface ButtonSpec {
  kind: 'minimize' | 'maximize' | 'close';
  label: string;
  onClick: () => void;
}

function WindowsButtons({ buttons, state }: { buttons: ButtonSpec[]; state: DesktopWindowState }) {
  const glyph = (kind: ButtonSpec['kind']) => {
    if (kind === 'minimize') return <FluentGlyph><path d="M0 5.5h10" /></FluentGlyph>;
    if (kind === 'close') return <FluentGlyph><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></FluentGlyph>;
    return state.maximized
      ? <FluentGlyph><rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></FluentGlyph>
      : <FluentGlyph><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></FluentGlyph>;
  };
  return buttons.map((button) => (
    <button
      key={button.kind}
      type="button"
      aria-label={button.label}
      title={button.label}
      onClick={button.onClick}
      // 46 x the bar's height, as Windows draws them; the close button turns
      // the system's own red rather than the app's
      className={cn(
        'flex h-full w-[46px] items-center justify-center transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary',
        state.focused ? 'text-text-primary' : 'text-text-faint',
        button.kind === 'close'
          ? 'hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90 active:text-white/80'
          : 'hover:bg-fill-hover active:bg-fill-active',
      )}
    >
      {glyph(button.kind)}
    </button>
  ));
}

function LinuxButtons({ buttons, state }: { buttons: ButtonSpec[]; state: DesktopWindowState }) {
  const glyph = (kind: ButtonSpec['kind']) => {
    if (kind === 'minimize') return <AdwaitaGlyph><path d="M4.75 11h6.5" /></AdwaitaGlyph>;
    if (kind === 'close') return <AdwaitaGlyph><path d="M5 5l6 6M11 5l-6 6" /></AdwaitaGlyph>;
    return state.maximized
      ? <AdwaitaGlyph><rect x="4.75" y="6.25" width="5" height="5" rx="1" /><path d="M6.75 4.75h3.5a1 1 0 0 1 1 1v3.5" /></AdwaitaGlyph>
      : <AdwaitaGlyph><rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1" /></AdwaitaGlyph>;
  };
  return buttons.map((button) => (
    <button
      key={button.kind}
      type="button"
      aria-label={button.label}
      title={button.label}
      onClick={button.onClick}
      // libadwaita's window buttons: a 24 px circle with a faint fill that darkens on hover and press
      className={cn(
        'flex size-6 items-center justify-center rounded-full bg-fill-hover transition-colors duration-100 hover:bg-fill-active active:bg-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
        state.focused ? 'text-text-primary' : 'text-text-faint',
      )}
    >
      {glyph(button.kind)}
    </button>
  ));
}

/**
 * Minimise, maximise and close for a window without a system title bar,
 * drawn the way each system draws its own. macOS keeps its native traffic
 * lights (the desktop app places them in this bar), so it gets nothing here.
 */
export function WindowControls({ controls, platform, className }: { controls: DesktopWindowControls; platform: string; className?: string }) {
  const { t } = useTranslation('common');
  const state = useDesktopWindowState(controls);
  const style = titleBarStyle(platform, controls);
  if (style === 'mac') return null;

  const buttons: ButtonSpec[] = [
    { kind: 'minimize', label: t('layout.window.minimize'), onClick: () => { void controls.minimize(); } },
    { kind: 'maximize', label: state.maximized ? t('layout.window.restore') : t('layout.window.maximize'), onClick: () => { void controls.toggleMaximize(); } },
    { kind: 'close', label: t('layout.window.close'), onClick: () => { void controls.close(); } },
  ];

  return (
    <div
      role="group"
      aria-label={t('layout.window.controls')}
      data-title-bar-style={style}
      className={cn('app-no-drag flex flex-none self-stretch', style === 'windows' ? 'items-stretch' : 'items-center gap-2 px-2', className)}
    >
      {style === 'windows' ? <WindowsButtons buttons={buttons} state={state} /> : <LinuxButtons buttons={buttons} state={state} />}
    </div>
  );
}
