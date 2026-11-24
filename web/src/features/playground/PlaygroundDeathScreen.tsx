import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PIXEL_TEXT } from './pixelFont';
import { PIXEL_BUTTON, PIXEL_SHADOW } from './pixelUi';

// The block game's death screen: the world goes on under a dark red veil, with
// who did it and a button to respawn, which wakes up after a second (the game's
// 20 ticks) so a click meant for the fight does not skip it.

const RESPAWN_DELAY_MS = 1000;

export function PlaygroundDeathScreen({ killerName, onRespawn }: { killerName: string | null; onRespawn: () => void }) {
  const { t } = useTranslation('playground');
  const [ready, setReady] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), RESPAWN_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready) buttonRef.current?.focus({ preventScroll: true });
  }, [ready]);

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="playground-death-title"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-linear-to-b from-[#500000]/40 to-[#803030]/65 p-6 text-center text-white">
      <div className="flex flex-col items-center gap-2">
        <h2 id="playground-death-title" className={`${PIXEL_TEXT.huge} leading-none ${PIXEL_SHADOW}`}>{t('death.title')}</h2>
        {killerName && <p className={`${PIXEL_TEXT.lg} leading-none text-white/85 ${PIXEL_SHADOW}`}>{t('death.killedBy', { name: killerName })}</p>}
      </div>
      <button ref={buttonRef} type="button" onClick={onRespawn} aria-disabled={!ready} disabled={!ready} className={`${PIXEL_BUTTON} w-72`}>
        {t('death.respawn')}
      </button>
    </div>
  );
}
