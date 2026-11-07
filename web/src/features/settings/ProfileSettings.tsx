import { PlusIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

import { Link, useBlocker } from 'react-router';
import { ImageCropDialog } from './ImageCropDialog';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { ProfileConnections } from '@/features/profile/ProfileConnections';
import { ProfileSidebar } from '@/features/profile/ProfileSidebar';
import { formatProfileDate, useProfileDetails } from '@/features/profile/useProfileDetails';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { ROUTES } from '@/shared/lib/routes';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO } from '@/features/profile/profileLinks';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';
import { describeProfileSaveError } from '@/features/profile/useProfileUpdate';
import type { ProfileImageUploadPhase } from './uploadCroppedProfileImage';
import { useProfileDraft } from './useProfileDraft';
import { UnsavedProfileChangesDialog } from './UnsavedProfileChangesDialog';

type ProfileCropTarget = { field: 'avatar' | 'banner'; file: File; src: string };

export function ProfileSettings() {
  const { t } = useTranslation('settings');
  const { t: profileT } = useTranslation('profile');
  const { state, updateProfile, uploadProfileImage, removeProfileImage, activeCallConversationId } = useRoom();
  const details = useProfileDetails(state.me.userId);
  // FloatingPip (a call kept running while browsing elsewhere) sits fixed at
  // the viewport's bottom-left, on top of whatever's there — on a narrow
  // screen that's exactly where this bar's own Descartar button lands,
  // making it untappable. Shifting the bar up clears it (same idea as
  // FloatingPip's own `bottom-20` when the ReconnectBanner takes that corner).
  const inCall = activeCallConversationId !== null;
  const [avatar, setAvatar] = useState(state.me.avatar);
  const [avatarPoster, setAvatarPoster] = useState(state.me.avatarPoster);
  const [banner, setBanner] = useState(state.me.banner);
  const [bannerPoster, setBannerPoster] = useState(state.me.bannerPoster);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerUploadProgress, setBannerUploadProgress] = useState(0);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<ProfileCropTarget | null>(null);
  // The crop dialog stays mounted during WASM processing, then gives way to
  // the blocking upload modal when the encoded blob is ready.
  const [activeUpload, setActiveUpload] = useState<{ field: 'avatar' | 'banner'; phase: ProfileImageUploadPhase } | null>(null);

  // Avatar and banner save immediately; text fields use the draft flow.
  const baseline = useMemo(() => ({
    displayName: state.me.displayName,
    avatarColor: normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR,
    bio: state.me.bio,
  }), [state.me.displayName, state.me.avatarColor, state.me.bio]);

  const { draft, setField, dirty, saveState, error: saveError, conflict, save, discard, applyIncoming } = useProfileDraft({
    baseline,
    save: (fields) => updateProfile({
      avatar, avatarPoster, banner, bannerPoster,
      ...fields,
    }),
  });
  const saving = saveState === 'saving';

  useEffect(() => {
    setAvatar(state.me.avatar);
    setAvatarPoster(state.me.avatarPoster);
  }, [state.me.avatar, state.me.avatarPoster]);
  useEffect(() => {
    setBanner(state.me.banner);
    setBannerPoster(state.me.bannerPoster);
  }, [state.me.banner, state.me.bannerPoster]);

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const timeout = window.setTimeout(() => setJustSaved(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [justSaved]);

  async function handleSave() {
    try {
      await save();
      setJustSaved(true);
    } catch {
      // surfaced via `saveError` below — nothing else to do here
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    void handleSave();
  }

  // Leaving the Profile category (another settings tab, another page, the
  // browser's back/forward) with a dirty draft opens the 3-way prompt
  // instead of silently discarding it. Scoped to a real page change, not an
  // in-page hash jump (e.g. scrolling to a section keeps the same pathname).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  async function handleSaveAndLeave() {
    try {
      await save();
      blocker.proceed?.();
    } catch {
      // dialog stays open, `saveError` shows why
    }
  }

  function handleFilePicked(field: 'avatar' | 'banner', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t('profile.fileTooLarge', { max: formatMB(MAX_AVATAR_BYTES) }));
      return;
    }
    setError(null);
    setCropTarget({ field, file, src: URL.createObjectURL(file) });
  }

  function closeCropDialog() {
    if (cropTarget) URL.revokeObjectURL(cropTarget.src);
    setCropTarget(null);
  }

  async function handleCropConfirm(crop: Area) {
    if (!cropTarget) return;
    const target = cropTarget;
    const { field } = target;
    const setUploading = field === 'avatar' ? setUploadingAvatar : setUploadingBanner;
    const setProgress = field === 'avatar' ? setAvatarUploadProgress : setBannerUploadProgress;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    setError(null);
    setProgress(0);
    setUploading(true);
    setActiveUpload({ field, phase: 'processing' });
    try {
      // Sends only avatar/avatarPoster (or banner/bannerPoster) — never the
      // profile draft, whatever it currently holds. The preview below
      // updates once the server confirms it (via state.me, picked up by the
      // sync effect above), not from this call.
      await uploadProfileImage(field, target.file, crop, setProgress, (phase) => {
        setActiveUpload({ field, phase });
        if (phase === 'uploading') closeCropDialog();
      });
    } catch (err) {
      setError(describeProfileSaveError(err, t(`profile.uploadFailed.${field}`)));
    } finally {
      setUploading(false);
      setActiveUpload(null);
    }
  }

  async function handleRemoveImage(field: 'avatar' | 'banner') {
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    setError(null);
    try {
      await removeProfileImage(field);
    } catch (err) {
      setError(describeProfileSaveError(err, t(`profile.removeFailed.${field}`)));
    }
  }

  const showBar = dirty || saveState === 'saving' || saveState === 'error';

  // The save bar floats over the bottom of the page, so the field whose edit
  // made it appear (a link field near the bottom, say) can end up underneath
  // it. Scroll that field back above the bar; the form's scroll-margin leaves
  // room for it.
  const lastTouchedRef = useRef<HTMLElement | null>(null);
  function rememberTouched(e: { target: EventTarget }) {
    if (e.target instanceof HTMLElement) lastTouchedRef.current = e.target;
  }
  useEffect(() => {
    if (showBar) lastTouchedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [showBar]);
  const barStatusText = saveState === 'error' ? saveError
    : saving ? t('profile.saving')
    : dirty ? t('profile.unsavedNotice')
    : '';

  const userId = state.me.userId;

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleFormSubmit}
        onPointerDownCapture={rememberTouched}
        onFocusCapture={rememberTouched}
        className={cn('flex flex-col gap-4', showBar && 'pb-24 [&_*]:scroll-mb-28')}
      >
        <div className="overflow-hidden rounded-lg border border-border bg-bg-modal md:grid md:h-[min(42rem,calc(100dvh-14rem))] md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
          <div className="scrollbar-none min-w-0 md:min-h-0 md:overflow-y-auto md:border-r md:border-border">
            <ProfileCard
              bare
              user={{
                id: state.me.id || 'preview',
                displayName: draft.displayName || state.me.name,
                username: state.me.name,
                avatar, avatarColor: draft.avatarColor, banner, bio: draft.bio,
                profileLinks: state.me.profileLinks,
                role: state.me.role,
              }}
              online
              onAvatarUpload={() => avatarFileInputRef.current?.click()}
              onAvatarRemove={() => void handleRemoveImage('avatar')}
              avatarUploading={uploadingAvatar}
              onBannerUpload={() => bannerFileInputRef.current?.click()}
              onBannerRemove={() => void handleRemoveImage('banner')}
              bannerUploading={uploadingBanner}
              onDisplayNameChange={(value) => setField('displayName', value)}
              onBioChange={(value) => setField('bio', value)}
              onAvatarColorChange={(value) => setField('avatarColor', value)}
              hideLinks
              fieldsDisabled={saving}
              footer={(
                <div className="mt-5 flex flex-col gap-4">
                  <dl className="flex flex-col gap-3">
                    {details.details && (
                      <div>
                        <dt className="text-caption font-medium text-text-muted">{profileT('modal.memberSince')}</dt>
                        <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.memberSince)}</dd>
                      </div>
                    )}
                    {details.details?.friendsSince && (
                      <div>
                        <dt className="text-caption font-medium text-text-muted">{profileT('modal.friendsSince')}</dt>
                        <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.friendsSince)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-caption font-medium text-text-muted">{profileT('connections')}</h3>
                    <ProfileConnections links={state.me.profileLinks} hideHeading />
                    <Link
                      to={ROUTES.settingsTab('connections')}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md py-1 text-label text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PlusIcon size={14} aria-hidden />
                      {profileT('integration.addLink')}
                    </Link>
                  </div>
                </div>
              )}
            />
          </div>
          {userId && (
            <div className="flex min-h-80 min-w-0 flex-col border-t border-border md:min-h-0 md:border-t-0">
              <ProfileSidebar
                userId={userId}
                owner
                status={details.status}
                details={details.details}
                onRetry={details.retry}
                onOpenProfile={() => {}}
                onOpenServer={() => {}}
                onNavigate={() => {}}
              />
            </div>
          )}
        </div>
        <input
          ref={avatarFileInputRef}
          aria-label={t('profile.avatarInput')}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('avatar', e)}
        />
        <input
          ref={bannerFileInputRef}
          aria-label={t('profile.bannerInput')}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('banner', e)}
        />
        {avatarError && <p role="alert" className="text-label text-red">{avatarError}</p>}
        {bannerError && <p role="alert" className="text-label text-red">{bannerError}</p>}

        <p className="text-caption text-text-muted">
          {t('profile.formats', { max: formatMB(MAX_AVATAR_BYTES) })}
        </p>

        {justSaved && (
          <p role="status" className="text-label font-medium text-green">
            {t('profile.saved')}
          </p>
        )}

        {conflict && dirty && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-strong bg-bg-tertiary px-4 py-3 text-label text-text-secondary">
            <span>{t('profile.conflict')}</span>
            <Button type="button" variant="ghost" size="sm" onClick={applyIncoming}>
              <span>{t('profile.useSaved')}</span>
            </Button>
          </div>
        )}

        {showBar && (
          <div
            role="region"
            aria-label={t('profile.barLabel')}
            className={cn(
              'fixed left-1/2 z-50 flex w-[min(100%,28rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg-floating/95 px-4 py-3 shadow-popover backdrop-blur-xl',
              inCall ? 'bottom-20' : 'bottom-[max(1rem,env(safe-area-inset-bottom))]',
            )}
          >
            <p role={saveState === 'error' ? 'alert' : undefined} className={saveState === 'error' ? 'text-label text-red' : 'text-label text-text-muted'}>
              {barStatusText}
            </p>
            <div className="flex gap-2">
              {dirty && (
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={discard}>
                  <span>{t('profile.discard')}</span>
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                <span>{saving ? t('profile.saving') : t('profile.save')}</span>
              </Button>
            </div>
          </div>
        )}
      </form>

      <UnsavedProfileChangesDialog
        open={blocker.state === 'blocked'}
        saving={saving}
        error={saveError}
        onContinueEditing={() => blocker.reset?.()}
        onDiscardAndLeave={() => { discard(); blocker.proceed?.(); }}
        onSaveAndLeave={() => void handleSaveAndLeave()}
      />

      <ImageCropDialog
        open={!!cropTarget}
        imageSrc={cropTarget?.src ?? null}
        processing={activeUpload?.phase === 'processing'}
        error={cropTarget?.field === 'banner' ? bannerError : avatarError}
        aspect={cropTarget?.field === 'banner' ? BANNER_ASPECT_RATIO : 1}
        cropShape={cropTarget?.field === 'banner' ? 'rect' : 'round'}
        title={cropTarget?.field === 'banner' ? t('profile.cropTitle.banner') : t('profile.cropTitle.avatar')}
        onCancel={closeCropDialog}
        onConfirm={handleCropConfirm}
      />


      <UploadProgressModal
        open={activeUpload?.phase === 'uploading'}
        title={activeUpload?.field === 'banner' ? t('profile.uploadingTitle.banner') : t('profile.uploadingTitle.avatar')}
        progress={activeUpload?.field === 'banner' ? bannerUploadProgress : avatarUploadProgress}
      />
    </div>
  );
}
