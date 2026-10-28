import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Area } from 'react-easy-crop';

import { useBlocker } from 'react-router';
import { ImageCropDialog } from './ImageCropDialog';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO } from '@/features/profile/profileLinks';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';
import { describeProfileSaveError } from '@/features/profile/useProfileUpdate';
import type { ProfileImageUploadPhase } from './uploadCroppedProfileImage';
import { useProfileDraft, normalizeProfileDraftFields } from './useProfileDraft';
import { UnsavedProfileChangesDialog } from './UnsavedProfileChangesDialog';

type ProfileCropTarget = { field: 'avatar' | 'banner'; file: File; src: string };

export function ProfileSettings() {
  const { state, updateProfile, uploadProfileImage, removeProfileImage, activeCallConversationId } = useRoom();
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

  // Avatar/banner apply immediately (E2) and never join this draft — only
  // name/color/bio/links go through baseline/draft/saveState (plano
  // §9.2). profileLinksKey guards against the array's fresh reference on
  // every socket message (JSON deserializes a new one even with identical
  // content) turning into a spurious "external change".
  const profileLinksKey = state.me.profileLinks.join('␟');
  const baseline = useMemo(() => ({
    displayName: state.me.displayName,
    avatarColor: normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR,
    bio: state.me.bio,
    profileLinks: state.me.profileLinks.length ? state.me.profileLinks : [''],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state.me.displayName, state.me.avatarColor, state.me.bio, profileLinksKey]);

  const { draft, setField, dirty, saveState, error: saveError, conflict, save, discard, applyIncoming } = useProfileDraft({
    baseline,
    save: (fields) => updateProfile({
      avatar, avatarPoster, banner, bannerPoster,
      ...normalizeProfileDraftFields(fields),
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

  function updateProfileLink(index: number, value: string) {
    setField('profileLinks', draft.profileLinks.map((link, i) => (i === index ? value : link)));
  }

  function addProfileLink() {
    setField('profileLinks', [...draft.profileLinks, '']);
  }

  function removeProfileLink(index: number) {
    const next = draft.profileLinks.filter((_, i) => i !== index);
    setField('profileLinks', next.length ? next : ['']);
  }

  function handleFilePicked(field: 'avatar' | 'banner', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`Arquivo muito grande (máximo ${formatMB(MAX_AVATAR_BYTES)}).`);
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
      setError(describeProfileSaveError(err, `Falha ao enviar ${field === 'avatar' ? 'a foto' : 'o banner'}.`));
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
      setError(describeProfileSaveError(err, `Não foi possível remover ${field === 'avatar' ? 'a foto' : 'o banner'}.`));
    }
  }

  const showBar = dirty || saveState === 'saving' || saveState === 'error';
  const barStatusText = saveState === 'error' ? saveError
    : saving ? 'Salvando…'
    : dirty ? 'Você tem alterações não salvas.'
    : '';

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleFormSubmit}
        className={cn('flex max-w-120 flex-col gap-3', showBar && 'pb-24')}
      >
        <ProfileCard
          user={{
            id: state.me.id || 'preview',
            displayName: draft.displayName || state.me.name,
            username: state.me.name,
            avatar, avatarColor: draft.avatarColor, banner, bio: draft.bio,
            profileLinks: normalizeProfileDraftFields(draft).profileLinks,
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
          editableLinks={draft.profileLinks}
          onLinkChange={updateProfileLink}
          onAddLink={addProfileLink}
          onRemoveLink={removeProfileLink}
          fieldsDisabled={saving}
        />
        <input
          ref={avatarFileInputRef}
          aria-label="Selecionar foto de perfil"
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('avatar', e)}
        />
        <input
          ref={bannerFileInputRef}
          aria-label="Selecionar banner"
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('banner', e)}
        />
        {avatarError && <p role="alert" className="text-label text-red">{avatarError}</p>}
        {bannerError && <p role="alert" className="text-label text-red">{bannerError}</p>}

        <p className="text-caption text-text-muted">
          PNG, JPEG, GIF ou WEBP, até {formatMB(MAX_AVATAR_BYTES)}. Foto e banner valem assim que você confirma o recorte; nome, cor, bio e links só depois de salvar.
        </p>

        {justSaved && (
          <p role="status" className="text-label font-medium text-green">
            Perfil salvo.
          </p>
        )}

        {conflict && dirty && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-strong bg-bg-tertiary px-4 py-3 text-label text-text-secondary">
            <span>Este perfil foi atualizado em outro lugar enquanto você editava.</span>
            <Button type="button" variant="ghost" size="sm" onClick={applyIncoming}>
              <span>Usar valores salvos</span>
            </Button>
          </div>
        )}

        {showBar && (
          <div
            role="region"
            aria-label="Salvar alterações do perfil"
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
                  <span>Descartar</span>
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                <span>{saving ? 'Salvando…' : 'Salvar perfil'}</span>
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
        title={cropTarget?.field === 'banner' ? 'Recortar banner' : 'Recortar foto de perfil'}
        onCancel={closeCropDialog}
        onConfirm={handleCropConfirm}
      />


      <UploadProgressModal
        open={activeUpload?.phase === 'uploading'}
        title={`Enviando ${activeUpload?.field === 'banner' ? 'o banner' : 'a foto de perfil'}…`}
        progress={activeUpload?.field === 'banner' ? bannerUploadProgress : avatarUploadProgress}
      />
    </div>
  );
}
