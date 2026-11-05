import { ArrowSquareOutIcon, AtIcon, CameraIcon, CheckIcon, CircleNotchIcon, PaletteIcon, PencilSimpleIcon, SealCheckIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar, AVATAR_COLOR_OPTIONS } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO, BrandIcon, bannerStyle, linkInfo } from '@/features/profile/profileLinks';
import type { LinkInfo } from '@/features/profile/profileLinks';
import { MAX_DISPLAY_NAME_LEN } from '@/shared/lib/displayName';
import { MAX_PROFILE_BIO_LEN } from '@/shared/types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';

interface ProfileCardData {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
}

interface ProfileCardProps {
  user: ProfileCardData;
  online?: boolean;
  onAvatarClick?: () => void;
  onBannerClick?: () => void;
  onAvatarUpload?: () => void;
  onAvatarRemove?: () => void;
  avatarUploading?: boolean;
  onBannerUpload?: () => void;
  onBannerRemove?: () => void;
  bannerUploading?: boolean;
  className?: string;
  /** no border or rounded-sm corners of its own — for a container that already has an edge (the profile modal) */
  bare?: boolean;
  /** Makes the display name an inline text field instead of a heading —
   * editing happens right where the value is shown, Twitter-style. */
  onDisplayNameChange?: (value: string) => void;
  /** Makes the bio an inline, auto-growing textarea instead of a paragraph. */
  onBioChange?: (value: string) => void;
  onAvatarColorChange?: (value: string) => void;
  /** Freezes draft fields while a save is in flight. */
  fieldsDisabled?: boolean;
  /** shown under the name, above the bio (the profile modal's buttons) */
  actions?: ReactNode;
  /** shown at the end of the name's line, above the username */
  nameAction?: ReactNode;
  /** shown under the bio, in place of the link icons when `hideLinks` is set */
  footer?: ReactNode;
  /** leaves the link icons out, for a footer that lists them its own way */
  hideLinks?: boolean;
}

function EditableBio({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useTranslation('profile');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="mt-4 flex flex-col items-end gap-1">
      <textarea
        ref={ref}
        aria-label={t('card.bio')}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_PROFILE_BIO_LEN))}
        placeholder={t('card.bioPlaceholder')}
        rows={1}
        disabled={disabled}
        className="w-full resize-none overflow-hidden whitespace-pre-wrap bg-transparent text-body leading-relaxed text-text-secondary outline-none placeholder:text-text-muted/70 disabled:opacity-60"
      />
      <span className="select-none text-caption tabular-nums text-text-muted">{value.length}/{MAX_PROFILE_BIO_LEN}</span>
    </div>
  );
}

export function ProfileCard({
  user, online, onAvatarClick, onBannerClick,
  onAvatarUpload, onAvatarRemove, avatarUploading,
  onBannerUpload, onBannerRemove, bannerUploading,
  className,
  onDisplayNameChange, onBioChange, onAvatarColorChange,
  bare, fieldsDisabled, actions, nameAction, footer, hideLinks,
}: ProfileCardProps) {
  const { t } = useTranslation('profile');
  const links = (user.profileLinks ?? []).map(linkInfo).filter((item): item is LinkInfo => !!item);
  const isCustomAvatarColor = !AVATAR_COLOR_OPTIONS.some((option) => option.value === user.avatarColor);

  return (
    <div className={cn('overflow-hidden bg-bg-modal', !bare && 'rounded-lg border border-border-strong', className)}>
      {onBannerUpload ? (
        <div className="group relative w-full" style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }}>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={bannerUploading}
              render={
                <button
                  type="button"
                  aria-label={t('card.changeBanner')}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white focus-visible:bg-black/40 focus-visible:text-white focus-visible:outline-none disabled:cursor-default"
                />
              }
            >
              {bannerUploading ? <CircleNotchIcon size={24} className="animate-spin" /> : <CameraIcon size={24} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-max min-w-0">
              <DropdownMenuItem onClick={onBannerUpload}>
                <UploadSimpleIcon size={14} />
                <span>{t('card.uploadFromComputer')}</span>
              </DropdownMenuItem>
              {user.banner && onBannerRemove && (
                <DropdownMenuItem variant="destructive" onClick={onBannerRemove}>
                  <TrashIcon size={14} />
                  <span>{t('card.removeBanner')}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : onBannerClick ? (
        <button
          type="button"
          aria-label={t('card.viewBanner')}
          onClick={onBannerClick}
          className="block w-full cursor-zoom-in"
          style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }}
        />
      ) : (
        <div className="w-full" style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }} />
      )}
      <div className="px-6 pb-6">
        <div className="-mt-12 flex items-end gap-3">
          <div className="relative rounded-full bg-bg-modal p-1">
            {onAvatarUpload ? (
              <div className="group relative rounded-full">
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={avatarUploading}
                    render={
                      <button
                        type="button"
                        aria-label={t('card.changeAvatar')}
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-transparent transition-colors group-hover:bg-black/50 group-hover:text-white focus-visible:bg-black/50 focus-visible:text-white focus-visible:outline-none disabled:cursor-default"
                      />
                    }
                  >
                    {avatarUploading ? <CircleNotchIcon size={20} className="animate-spin" /> : <CameraIcon size={20} />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-max min-w-0">
                    <DropdownMenuItem onClick={onAvatarUpload}>
                      <UploadSimpleIcon size={14} />
                      <span>{t('card.uploadFromComputer')}</span>
                    </DropdownMenuItem>
                    {user.avatar && onAvatarRemove && (
                      <DropdownMenuItem variant="destructive" onClick={onAvatarRemove}>
                        <TrashIcon size={14} />
                        <span>{t('card.removeAvatar')}</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : user.avatar && onAvatarClick ? (
              <button
                type="button"
                aria-label={t('card.viewAvatar')}
                onClick={onAvatarClick}
                className="block cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
              </button>
            ) : (
              <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
            )}
            {online && <span className="absolute right-1 bottom-1 h-5 w-5 rounded-full border-4 border-bg-modal bg-green" />}
            {online === false && (
              <span aria-hidden className="absolute right-1 bottom-1 grid h-5 w-5 place-items-center rounded-full border-4 border-bg-modal bg-text-muted">
                <span className="size-1.5 rounded-full bg-bg-modal" />
              </span>
            )}
          </div>

          {onAvatarColorChange && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {AVATAR_COLOR_OPTIONS.map((option) => {
                const selected = user.avatarColor === option.value;
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={t('card.useColor', { name: t(`common:${option.labelKey}`, { defaultValue: option.labelKey }) })}
                          aria-pressed={selected}
                          disabled={fieldsDisabled}
                          onClick={() => onAvatarColorChange(option.value)}
                          className={cn(
                            'grid h-5 w-5 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
                            selected ? 'border-text-primary ring-2 ring-ring/40 ring-offset-1 ring-offset-bg-modal' : 'border-border-strong hover:border-text-muted'
                          )}
                          style={{ background: option.css }}
                        />
                      }
                    >
                      {selected && <CheckIcon size={11} weight="bold" className="pointer-events-none text-white drop-shadow" />}
                    </TooltipTrigger>
                        <TooltipContent side="top">{t(`common:${option.labelKey}`, { defaultValue: option.labelKey })}</TooltipContent>
                  </Tooltip>
                );
              })}
              <label
                className={cn(
                  'relative flex h-5 w-5 items-center justify-center rounded-full border transition focus-within:outline-none focus-within:ring-3 focus-within:ring-ring/40',
                  isCustomAvatarColor ? 'border-text-primary ring-2 ring-ring/40 ring-offset-1 ring-offset-bg-modal' : 'border-border-strong hover:border-text-muted'
                )}
              >
                <input
                  type="color"
                  aria-label={t('card.customColorLabel')}
                  aria-pressed={isCustomAvatarColor}
                  disabled={fieldsDisabled}
                  value={isCustomAvatarColor ? user.avatarColor : '#6b7280'}
                  onChange={(e) => onAvatarColorChange(e.target.value)}
                  className="avatar-color-custom-input h-5 w-5 cursor-pointer disabled:cursor-default disabled:opacity-60"
                />
                <span className="pointer-events-none absolute inset-0 m-auto flex h-2.5 w-2.5 items-center justify-center">
                  {isCustomAvatarColor ? <CheckIcon size={10} weight="bold" className="text-white drop-shadow" /> : <PaletteIcon size={9} className="text-white/90 drop-shadow" />}
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-3 flex min-w-0 flex-col gap-1">
          {onDisplayNameChange ? (
            // the pencil and underline are the only hint that the name is a field
            <label className="group/name flex min-w-0 items-center gap-2 border-b border-transparent focus-within:border-primary/50 hover:border-border-strong">
              <input
                aria-label={t('card.displayName')}
                maxLength={MAX_DISPLAY_NAME_LEN}
                placeholder={user.username}
                disabled={fieldsDisabled}
                value={user.displayName === user.username ? '' : user.displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                className="w-full min-w-0 bg-transparent text-display font-bold text-text-primary outline-none placeholder:text-text-muted/70 disabled:opacity-60"
              />
              <PencilSimpleIcon size={18} aria-hidden className="flex-none text-text-muted opacity-60 transition-opacity group-hover/name:opacity-100 group-focus-within/name:opacity-100" />
            </label>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-display font-bold text-text-primary">{user.displayName}</h2>
              {nameAction && <div className="flex-none">{nameAction}</div>}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <p className="flex min-w-0 items-center gap-0.5 truncate text-label text-text-muted">
              <AtIcon size={14} className="flex-none" />
              <span className="truncate">{user.username}</span>
            </p>
            {user.role === 'admin' && (
              <span className="flex flex-none items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-accent-text">
                <SealCheckIcon size={13} /> {t('card.admin')}
              </span>
            )}
          </div>
        </div>

        {actions && <div className="mt-4">{actions}</div>}

        {onBioChange ? (
          <EditableBio value={user.bio} onChange={onBioChange} disabled={fieldsDisabled} />
        ) : (
          user.bio && <p className="mt-4 whitespace-pre-wrap text-body leading-relaxed text-text-secondary">{user.bio}</p>
        )}

        {hideLinks ? null : (
          links.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {links.map((link) => (
                <Tooltip key={link.url}>
                  <TooltipTrigger
                    render={
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('card.openLink', { name: link.label })}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-border-strong bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    }
                  >
                    <BrandIcon kind={link.kind} />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="flex items-center gap-1.5">
                    <span>{link.label}</span>
                    <ArrowSquareOutIcon size={12} />
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )
        )}

        {footer}
      </div>
    </div>
  );
}
