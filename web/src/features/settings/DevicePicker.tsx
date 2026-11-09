import { VideoCameraIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { cn } from '@/shared/lib/utils';
import { useCameraPreview } from './useCameraPreview';
import { useMicLevelMeter } from './useMicLevelMeter';
import { useSpeakerTest } from './useSpeakerTest';
import type { MediaDevicesApi } from './useMediaDevices';

const FIELD_LABEL = 'block text-body font-medium text-text-primary';

/** A device choice: its label, then the picker — or, while the browser keeps
 * the names to itself, a button of the same size asking for them. */
export function DeviceSelect({ label, devices, icon }: { label: string; devices: MediaDevicesApi; icon?: React.ReactNode }) {
  const { t } = useTranslation('settings');
  const { devices: list, activeDeviceId, status, switching, error, selectDevice, requestPermission } = devices;
  const controlId = useId();
  const current = list.find((d) => d.deviceId === activeDeviceId)?.label || t('av.systemDefault');

  let control;
  if (status === 'permission-needed') {
    control = (
      <Button id={controlId} type="button" variant="secondary" title={t('av.allowAccess')} className="h-10 w-full justify-start text-body" onClick={() => void requestPermission()}>
        {icon}
        <span className="truncate">{t('av.allowAccessShort')}</span>
      </Button>
    );
  } else if (status === 'unsupported' || status === 'permission-denied') {
    // Asking again wouldn't help in either case — browsers don't re-prompt
    // once denied, and there's nothing to prompt for when the API is missing.
    control = <p id={controlId} className="flex min-h-10 items-center text-label text-text-muted">{t(`av.status.${status}`)}</p>;
  } else {
    control = (
      <Select value={activeDeviceId} onValueChange={(v) => v && void selectDevice(v)} disabled={status === 'checking' || list.length === 0 || switching}>
        <SelectTrigger id={controlId} className="h-10 w-full text-body">
          <SelectValue>
            {() => (
              <span className="flex min-w-0 items-center gap-2">
                {icon && <span aria-hidden className="flex flex-none text-text-secondary">{icon}</span>}
                <span className="truncate">{status === 'no-devices' ? t('av.status.no-devices') : current}</span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {list.map((d) => (
            <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={controlId} className={FIELD_LABEL}>{label}</label>
      {control}
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
    </div>
  );
}

const METER_BARS = 48;

/** "Mic test": a button and Discord's row of bars, lit from the left with how
 * loud the mic is. The bars are always there, so starting a test moves nothing. */
/** `onStarted` lets the device list read the names the test's own permission prompt just unlocked. */
export function MicTest({ deviceId, disabled, onStarted }: { deviceId: string | undefined; disabled?: boolean; onStarted?: () => void }) {
  const { t } = useTranslation('settings');
  const meter = useMicLevelMeter();
  useEffect(() => {
    if (meter.active) void meter.start(deviceId);
    // only reacting to the device changing — re-applies to whatever's now selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);
  const lit = meter.active ? Math.round(meter.level * METER_BARS) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <Button type="button" size="lg" className="min-w-36 flex-none text-body" disabled={disabled} onClick={() => (meter.active ? meter.stop() : void meter.start(deviceId).then(onStarted))}>
          {meter.active ? t('av.micTestStop') : t('av.micTest')}
        </Button>
        <div
          role="meter"
          aria-label={t('av.micLevel')}
          aria-valuenow={Math.round((meter.active ? meter.level : 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="flex h-6 min-w-0 flex-1 items-stretch justify-between gap-[3px]"
        >
          {Array.from({ length: METER_BARS }, (_, i) => (
            <span key={i} aria-hidden className={cn('w-1 flex-none rounded-full', i < lit ? 'bg-green' : 'bg-text-muted/35')} />
          ))}
        </div>
      </div>
      {meter.error && <p role="alert" className="text-label text-red-text">{meter.error}</p>}
    </div>
  );
}

export function SpeakerTestLink({ deviceId }: { deviceId: string | undefined }) {
  const { t } = useTranslation('settings');
  const { testing, error, test } = useSpeakerTest();
  return (
    <>
      <button type="button" disabled={testing} onClick={() => void test(deviceId)} className="font-medium text-accent-text hover:underline disabled:opacity-60">
        {testing ? t('av.playing') : t('av.speakerTest')}
      </button>
      {error && <span role="alert" className="block text-red-text">{error}</span>}
    </>
  );
}

/** A fixed 16:9 box: the "Test video" button in the middle until the camera
 * plays there, so the page keeps its height either way. */
export function CameraPreview({ deviceId, mirrored, disabled, onStarted }: { deviceId: string | undefined; mirrored: boolean; disabled?: boolean; onStarted?: () => void }) {
  const { t } = useTranslation('settings');
  const preview = useCameraPreview();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (preview.active) void preview.start(deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview.stream;
  }, [preview.stream]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-fill-subtle">
        {preview.active ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live self-preview, not media content */}
            <video ref={videoRef} aria-label={t('av.videoPreview')} autoPlay muted playsInline className="absolute inset-0 size-full bg-black object-cover" style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />
            <Button type="button" variant="secondary" size="lg" className="absolute bottom-3 right-3 text-body" onClick={() => preview.stop()}>
              {t('av.videoTestStop')}
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <VideoCameraIcon size={48} weight="fill" aria-hidden className="text-text-muted" />
            <Button type="button" size="lg" className="text-body" disabled={disabled} onClick={() => void preview.start(deviceId).then(onStarted)}>
              {t('av.videoTest')}
            </Button>
          </div>
        )}
      </div>
      {preview.error && <p role="alert" className="text-label text-red-text">{preview.error}</p>}
    </div>
  );
}
