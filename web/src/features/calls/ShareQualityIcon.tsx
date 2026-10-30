import { GameControllerIcon, MonitorIcon } from '@phosphor-icons/react';
import type { ShareQualityId } from './shareQualityPresets';

/** What each preset is for, at a glance, in the quality menus. */
export function ShareQualityIcon({ id }: { id: ShareQualityId }) {
  return id === 'game' ? <GameControllerIcon size={16} /> : <MonitorIcon size={16} />;
}
