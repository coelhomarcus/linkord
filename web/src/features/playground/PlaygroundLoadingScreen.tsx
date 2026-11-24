import { useTranslation } from 'react-i18next';
import dirtUrl from './assets/kenuis-default/dirt.png?url';
import { guiText } from './hud/gui';
import type { Loading } from './playgroundSession';

// The screen between joining a playground and standing in it, the block
// game's own: its dirt background, darkened, under a title and what is going
// on (connecting to the playground service, downloading the world, building
// its terrain, with a bar for that), at the GUI scale. When the service cannot
// be reached, or cannot open the world, it says so while it keeps trying.

const BAR = { width: 100, height: 2 } as const;
/** the game draws its menu background at a quarter of the dirt's brightness */
const DIM = 0.75;

export function PlaygroundLoadingScreen({ loading, scale }: { loading: Loading; scale: number }) {
  const { t } = useTranslation('playground');
  const failing = loading.phase === 'unreachable' || loading.phase === 'worldFailed';
  const step = t(`loading.${loading.phase === 'ready' ? 'building' : loading.phase}`);
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-20 grid place-items-center"
      style={{ backgroundImage: `linear-gradient(rgba(0,0,0,${DIM}), rgba(0,0,0,${DIM})), url(${dirtUrl})`, backgroundSize: `auto, ${32 * scale}px`, imageRendering: 'pixelated' }}>
      <div className="flex flex-col items-center px-6 text-center" style={{ gap: 8 * scale }}>
        <p style={guiText(scale)}>{t('loading.title')}</p>
        <p style={{ ...guiText(scale), color: failing ? '#ff8080' : 'white', maxWidth: 260 * scale }}>{step}</p>
        {loading.phase === 'building' && (
          <div aria-hidden className="relative" style={{ width: BAR.width * scale, height: BAR.height * scale, background: '#808080' }}>
            <div className="absolute inset-y-0 left-0" style={{ width: `${Math.round(loading.progress * 100)}%`, background: '#80ff80' }} />
          </div>
        )}
      </div>
    </div>
  );
}
