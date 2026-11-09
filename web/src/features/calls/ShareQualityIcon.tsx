import { GameControllerIcon, MonitorIcon } from '@phosphor-icons/react';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';

/** What each preset is for, at a glance, in the quality menus. */
export function ShareQualityIcon({ id }: { id: ShareQualityId }) {
  return SHARE_QUALITY_PRESETS[id].contentHint === 'motion' ? <GameControllerIcon size={16} /> : <MonitorIcon size={16} />;
}
