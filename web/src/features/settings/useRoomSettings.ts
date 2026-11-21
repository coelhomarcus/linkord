import { useCallback, useEffect, useState } from 'react';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from './useSettingsPreference';
import { loadHideAudioOnlyTiles, saveHideAudioOnlyTiles } from './useStageViewPreference';
import { loadShowTileBanners, saveShowTileBanners } from './useTileBannerPreference';
import { loadCompressImages, saveCompressImages } from './useCompressImagesPreference';
import { loadMirrorCameraPreview, saveMirrorCameraPreview } from './useCameraMirrorPreference';
import { loadShareQuality, saveShareQuality } from './useShareQualityPreference';
import type { ShareQualityId } from '@/features/calls/shareQualityPresets';
import { setVolume } from '@/shared/sounds';
import { setNotificationsModuleEnabled, loadNotificationsEnabled, saveNotificationsEnabled } from '@/shared/notifications';
import { loadColorTheme, saveColorTheme } from './useColorThemePreference';
import { usePreferenceValue } from '@/shared/preferences/accountPreferences';

/** The toggles and sliders under Ajustes that RoomProvider hands out — each backed by its own
 * `features/settings/useXPreference.ts` load/save pair. Most follow the account and are read from
 * its preferences, so a change on another device re-renders them; the notification volume, browser
 * notifications and share quality stay on this device in React state. `notifyVolume` and
 * `notificationsEnabled` also keep the `shared/sounds`/`shared/notifications` module-level singletons
 * in sync, since those modules can't read React state themselves. */
export function useRoomSettings() {
  const showStats = usePreferenceValue(loadShowStats);
  const setShowStats = saveShowStats;

  const [notifyVolume, setNotifyVolumeState] = useState(loadNotifyVolume);
  const setNotifyVolume = useCallback((value: number) => {
    setNotifyVolumeState(value);
    saveNotifyVolume(value);
    setVolume(value);
  }, []);

  const [notificationsEnabled, setNotificationsEnabledState] = useState(loadNotificationsEnabled);
  const setNotificationsEnabled = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    saveNotificationsEnabled(value);
    setNotificationsModuleEnabled(value);
  }, []);

  const hideAudioOnlyTiles = usePreferenceValue(loadHideAudioOnlyTiles);
  const setHideAudioOnlyTiles = saveHideAudioOnlyTiles;

  const showTileBanners = usePreferenceValue(loadShowTileBanners);
  const setShowTileBanners = saveShowTileBanners;

  const compressImagesDefault = usePreferenceValue(loadCompressImages);
  const setCompressImagesDefault = saveCompressImages;

  const mirrorCameraPreview = usePreferenceValue(loadMirrorCameraPreview);
  const setMirrorCameraPreview = saveMirrorCameraPreview;

  const [shareQuality, setShareQualityState] = useState(loadShareQuality);
  const setShareQuality = useCallback((value: ShareQualityId) => {
    setShareQualityState(value);
    saveShareQuality(value);
  }, []);

  const colorTheme = usePreferenceValue(loadColorTheme);
  const setColorTheme = saveColorTheme;

  useEffect(() => {
    setVolume(notifyVolume);
  }, [notifyVolume]);

  useEffect(() => {
    setNotificationsModuleEnabled(notificationsEnabled);
  }, [notificationsEnabled]);

  return {
    showStats, setShowStats,
    notifyVolume, setNotifyVolume,
    notificationsEnabled, setNotificationsEnabled,
    hideAudioOnlyTiles, setHideAudioOnlyTiles,
    showTileBanners, setShowTileBanners,
    compressImagesDefault, setCompressImagesDefault,
    mirrorCameraPreview, setMirrorCameraPreview,
    shareQuality, setShareQuality,
    colorTheme, setColorTheme,
  };
}
