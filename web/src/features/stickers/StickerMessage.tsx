import { StickerIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { ExpressionDetails } from '@/features/emoji/ExpressionPopover';
import { EXPRESSION_POPOVER_CLASS, useExpressionOrigin } from '@/features/emoji/expressionOrigin';
import { useOptionalRoomSelector } from '@/state/RoomContext';
import type { StickerCard } from '@/shared/types/protocol';
import { useKnownSticker, useMyStickers } from './myStickers';
import { stickerImageUrl } from './stickersApi';

/** A sent sticker, drawn large and without a bubble, like Discord's. Clicking
 * it says what it is, and which server it is from when the viewer is a member
 * there (ExpressionDetails). `null` is a sticker deleted since. */
export function StickerMessage({ sticker }: { sticker: StickerCard | null }) {
  const { t } = useTranslation('stickers');
  const [broken, setBroken] = useState(false);
  const known = useKnownSticker(sticker?.id ?? '');

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
        className="mt-0.5 block size-40 rounded-lg focus-ring"
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
      <PopoverContent side="top" align="start" className={EXPRESSION_POPOVER_CLASS}>
        <StickerDetails id={sticker.id} name={name} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while the popover is open: that is when the account's
 * sticker list has to be read, if nothing else has asked for it yet. */
function StickerDetails({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation('stickers');
  const mine = useMyStickers(useOptionalRoomSelector((room) => room.state.me.userId) ?? null);
  const known = useKnownSticker(id);
  const origin = useExpressionOrigin(known?.serverId, mine.status === 'ready');
  return (
    <ExpressionDetails
      picture={<img src={stickerImageUrl(id)} alt="" draggable={false} className="size-12 object-contain" />}
      name={name}
      description={origin ? t(`details.${origin.kind}`) : undefined}
      sourceLabel={t('details.source')}
      server={origin && origin.kind !== 'elsewhere' ? origin.server : undefined}
    />
  );
}
