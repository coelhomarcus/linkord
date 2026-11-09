import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { ROUTES } from '@/shared/lib/routes';
import { DEFAULT_AVATAR_COLOR, colorFor, normalizeAvatarColor } from '@/shared/Avatar';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';
import { ProfileCard } from './ProfileCard';
import { FLOATING_BAR_SLOT_CLASS, FloatingBar, FloatingBarSlotProvider, SAVED_BAR_MS } from '@/shared/FloatingBar';
import { ProfileConnections } from './ProfileConnections';
import { ProfileSidebar } from './ProfileSidebar';
import type { WallDraft } from './ProfileWall';
import { BANNER_ASPECT_RATIO } from './profileLinks';
import { UnsavedProfileChangesDialog } from './UnsavedProfileChangesDialog';
import { describeProfileSaveError } from './useProfileUpdate';
import { formatProfileDate } from './useProfileDetails';
import type { useProfileDetails } from './useProfileDetails';
import { useProfileDraft, type ProfileDraftFields } from './useProfileDraft';
import type { DisplayStatus } from '@/features/status/statusDisplay';
import { useCustomStatusActions } from '@/features/status/useCustomStatusActions';
import type { CustomStatus } from '@/shared/types/protocol';

type ProfileCropTarget = { field: 'avatar' | 'banner'; file: File; src: string };

/** Answers whether the profile modal may close now; `false` means the editor
 * is asking about unsaved changes first and closes it itself once answered. */
export type LeaveGuard = () => boolean;

/** Your own profile modal, editable in place: the same layout everyone else
 * sees, with the name, bio, colour and images changed right where they show. */
export function ProfileEditor({ status, customStatus, details, onClose, registerLeaveGuard }: {
  status: DisplayStatus;
  customStatus: CustomStatus | null;
  details: ReturnType<typeof useProfileDetails>;
  onClose: () => void;
  /** hands the modal the check it runs before closing, and `null` on unmount */
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
}) {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { state, updateProfile, uploadProfileImage, removeProfileImage } = useRoom();
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
  // the field whose picture is on its way: the crop dialog gives way to the
  // blocking upload modal as soon as the rect is confirmed
  const [activeUpload, setActiveUpload] = useState<'avatar' | 'banner' | null>(null);
  // what to do once the unsaved-changes prompt is answered (close, or follow a link)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [customStatusError, setCustomStatusError] = useState<string | null>(null);
  // the Wall's unsaved change, if any: it has its own Save, but closing the profile drops it all the same
  const wallDraft = useRef<WallDraft | null>(null);
  const onWallDraftChange = useCallback((next: WallDraft | null) => { wallDraft.current = next; }, []);
  const [wallSaving, setWallSaving] = useState(false);
  const [wallSaveError, setWallSaveError] = useState<string | null>(null);
  const customStatusActions = useCustomStatusActions(setCustomStatusError);

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
    const timeout = window.setTimeout(() => setJustSaved(false), SAVED_BAR_MS);
    return () => window.clearTimeout(timeout);
  }, [justSaved]);
  // an edit made while the bar still confirms the last save is a new pending change: show it, and Save, at once
  function edit<K extends keyof ProfileDraftFields>(key: K, value: ProfileDraftFields[K]) {
    setJustSaved(false);
    setField(key, value);
  }

  // Closing the modal (Esc, the X, the backdrop) with a dirty draft asks
  // first instead of silently dropping it.
  useEffect(() => {
    registerLeaveGuard(() => {
      if (!dirty && !wallDraft.current) return true;
      setWallSaveError(null);
      setPendingLeave(() => onClose);
      return false;
    });
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard, dirty, onClose]);

  function leave(action: () => void) {
    if (dirty || wallDraft.current) {
      setWallSaveError(null);
      setPendingLeave(() => action);
    } else action();
  }

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

  async function handleSaveAndLeave() {
    try {
      if (dirty) await save();
    } catch {
      // dialog stays open, `saveError` shows why
      return;
    }
    const wall = wallDraft.current;
    if (wall) {
      setWallSaveError(null);
      setWallSaving(true);
      const saved = await wall.save();
      setWallSaving(false);
      if (!saved) {
        setWallSaveError(t('wall.saveFailed'));
        return;
      }
    }
    const action = pendingLeave;
    setPendingLeave(null);
    action?.();
  }

  function handleDiscardAndLeave() {
    discard();
    wallDraft.current?.reset();
    const action = pendingLeave;
    setPendingLeave(null);
    action?.();
  }

  function handleFilePicked(field: 'avatar' | 'banner', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t('editor.fileTooLarge', { max: formatMB(MAX_AVATAR_BYTES) }));
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
    setActiveUpload(field);
    closeCropDialog();
    try {
      // Sends only avatar/avatarPoster (or banner/bannerPoster) — never the
      // profile draft, whatever it currently holds. The preview updates once
      // the server confirms it (via state.me, picked up by the sync effect
      // above), not from this call.
      await uploadProfileImage(field, target.file, crop, setProgress);
    } catch (err) {
      setError(describeProfileSaveError(err, t(`editor.uploadFailed.${field}`)));
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
      setError(describeProfileSaveError(err, t(`editor.removeFailed.${field}`)));
    }
  }

  const showBar = dirty || saveState === 'saving' || saveState === 'error' || justSaved;

  // The save bar floats over the bottom of the modal, so the field whose edit
  // made it appear can end up underneath it. Scroll that field back above
  // the bar; the columns' scroll-margin leaves room for it.
  const lastTouchedRef = useRef<HTMLElement | null>(null);
  function rememberTouched(e: { target: EventTarget; currentTarget: EventTarget }) {
    // a popover (the colour picker) is portalled out of the form, but its events still bubble through it:
    // the field to bring back is the one in the form that opened it, not something in the popover
    if (e.target instanceof HTMLElement && e.currentTarget instanceof HTMLElement && e.currentTarget.contains(e.target)) lastTouchedRef.current = e.target;
  }
  useEffect(() => {
    if (showBar) lastTouchedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [showBar]);

  const userId = state.me.userId;
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);

  return (
    <FloatingBarSlotProvider value={barSlot}>
      <form
        onSubmit={handleFormSubmit}
        onPointerDownCapture={rememberTouched}
        onFocusCapture={rememberTouched}
        className={cn(
          'scrollbar-none min-h-0 overflow-y-auto md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden',
          showBar && 'pb-20 md:pb-0 [&_*]:scroll-mb-24',
        )}
      >
        <div className={cn('scrollbar-none min-w-0 md:min-h-0 md:overflow-y-auto md:border-r md:border-border', showBar && 'md:pb-20')}>
          <ProfileCard
            bare
            user={{
              id: state.me.userId ?? state.me.id ?? 'preview',
              displayName: draft.displayName || state.me.name,
              username: state.me.name,
              avatar, avatarColor: draft.avatarColor, banner, bio: draft.bio,
              profileLinks: state.me.profileLinks,
              role: state.me.role,
            }}
            status={status}
            customStatus={customStatus}
            onEditCustomStatus={() => { setCustomStatusError(null); customStatusActions.openEditor(); }}
            onClearCustomStatus={() => { setCustomStatusError(null); customStatusActions.clear(); }}
            onAvatarUpload={() => avatarFileInputRef.current?.click()}
            onAvatarRemove={() => void handleRemoveImage('avatar')}
            avatarUploading={uploadingAvatar}
            onBannerUpload={() => bannerFileInputRef.current?.click()}
            onBannerRemove={() => void handleRemoveImage('banner')}
            bannerUploading={uploadingBanner}
            onDisplayNameChange={(value) => edit('displayName', value)}
            onBioChange={(value) => edit('bio', value)}
            onAvatarColorChange={(value) => edit('avatarColor', value)}
            hideLinks
            fieldsDisabled={saving}
            footer={(
              <div className="mt-5 flex flex-col gap-4">
                {conflict && dirty && (
                  <div className="flex flex-col items-start gap-2 rounded-lg border border-border-strong bg-bg-tertiary px-3 py-2.5 text-label text-text-secondary">
                    <span>{t('editor.conflict')}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={applyIncoming}>
                      <span>{t('editor.useSaved')}</span>
                    </Button>
                  </div>
                )}
                {avatarError && <p role="alert" className="text-label text-red">{avatarError}</p>}
                {bannerError && <p role="alert" className="text-label text-red">{bannerError}</p>}
                {customStatusError && <p role="alert" className="text-label text-red">{customStatusError}</p>}
                <dl className="flex flex-col gap-3">
                  {details.details && (
                    <div>
                      <dt className="text-caption font-medium text-text-muted">{t('modal.memberSince')}</dt>
                      <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.memberSince)}</dd>
                    </div>
                  )}
                </dl>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-caption font-medium text-text-muted">{t('connections')}</h3>
                  <ProfileConnections links={state.me.profileLinks} hideHeading />
                  <button
                    type="button"
                    onClick={() => leave(() => { navigate(ROUTES.settingsTab('connections')); onClose(); })}
                    className="touch-target relative inline-flex w-fit items-center gap-1.5 rounded-md py-1 text-label text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PlusIcon size={14} aria-hidden />
                    {t('integration.addLink')}
                  </button>
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
              accent={colorFor(userId, draft.avatarColor)}
              status={details.status}
              details={details.details}
              onRetry={details.retry}
              onOpenProfile={() => {}}
              onOpenServer={() => {}}
              onLeave={(go) => leave(() => { go(); onClose(); })}
              onWallDraftChange={onWallDraftChange}
            />
          </div>
        )}
        <input
          ref={avatarFileInputRef}
          aria-label={t('editor.avatarInput')}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('avatar', e)}
        />
        <input
          ref={bannerFileInputRef}
          aria-label={t('editor.bannerInput')}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('banner', e)}
        />

        <FloatingBar
          open={showBar}
          label={t('editor.barLabel')}
          status={saving ? 'saving' : saveState === 'error' ? 'error' : justSaved ? 'saved' : 'pending'}
          error={saveError}
          onReset={dirty ? discard : undefined}
        />
        {/* a phone's modal runs under the home indicator: the bars rest above it */}
        <div ref={setBarSlot} className={cn(FLOATING_BAR_SLOT_CLASS, 'bottom-[calc(1rem+var(--safe-bottom))] md:bottom-4')} />
      </form>

      {customStatusActions.dialog}

      <UnsavedProfileChangesDialog
        open={pendingLeave !== null}
        saving={saving || wallSaving}
        error={saveError ?? wallSaveError}
        onContinueEditing={() => setPendingLeave(null)}
        onDiscardAndLeave={handleDiscardAndLeave}
        onSaveAndLeave={() => void handleSaveAndLeave()}
      />

      <ImageCropDialog
        open={!!cropTarget}
        imageSrc={cropTarget?.src ?? null}
        error={cropTarget?.field === 'banner' ? bannerError : avatarError}
        aspect={cropTarget?.field === 'banner' ? BANNER_ASPECT_RATIO : 1}
        cropShape={cropTarget?.field === 'banner' ? 'rect' : 'round'}
        title={cropTarget?.field === 'banner' ? t('editor.cropTitle.banner') : t('editor.cropTitle.avatar')}
        onCancel={closeCropDialog}
        onConfirm={handleCropConfirm}
      />

      <UploadProgressModal
        open={!!activeUpload}
        title={activeUpload === 'banner' ? t('editor.uploadingTitle.banner') : t('editor.uploadingTitle.avatar')}
        progress={activeUpload === 'banner' ? bannerUploadProgress : avatarUploadProgress}
      />
    </FloatingBarSlotProvider>
  );
}
