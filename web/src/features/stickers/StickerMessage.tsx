import { StickerIcon } from '@phosphor-icons/react';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { RoomContext } from '@/state/RoomContext';
import type { StickerCard } from '@/shared/types/protocol';
import { useKnownSticker, useMyStickers } from './myStickers';
import { stickerImageUrl } from './stickersApi';

/** A sent sticker, drawn large and without a bubble, like Discord's. Clicking
 * it says what it is, and which server it is from when the viewer is a member
 * there. `null` is a sticker deleted since. */
export function StickerMessage({ sticker }: { sticker: StickerCard | null }) {
  const { t } = useTranslation('stickers');
  const [broken, setBroken] = useState(false);
  const room = useContext(RoomContext);
  // the account's own list says whether the viewer is a member of the sticker's server
  const mine = useMyStickers(room?.state.me.userId ?? null, !!sticker);
  const known = useKnownSticker(sticker?.id ?? '');
  const server = room?.servers.find((s) => s.id === known?.serverId);

  if (!sticker || broken) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-label text-text-muted">
        <StickerIcon size={16} className="flex-none" aria-hidden />
        {sticker ? t('message.named', { name: sticker.name }) : t('message.unavailable')}
      </span>
    );
  }

  const name = known?.name ?? sticker.name;
  const description = known?.description ?? sticker.description;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={t('message.open', { name })}
        className="mt-0.5 block size-40 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      >
        <img
          src={stickerImageUrl(sticker.id)}
          alt={description || name}
          width={160}
          height={160}
          draggable={false}
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-40 object-contain"
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="flex w-64 flex-col gap-1 p-3">
        <span className="text-label font-semibold text-text-primary">{name}</span>
        {description && <span className="text-caption text-text-secondary">{description}</span>}
        {server && <span className="text-caption text-text-muted">{t('from', { server: server.name })}</span>}
        {!server && mine.status === 'ready' && <span className="text-caption text-text-muted">{t('message.otherServer')}</span>}
      </PopoverContent>
    </Popover>
  );
}
