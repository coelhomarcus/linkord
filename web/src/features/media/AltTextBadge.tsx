import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';

/** "ALT" in a picture's corner, for the description its page gave it: a
 * popover, so a finger and a keyboard read it as easily as a pointer. The
 * picture's own alt carries the same text for screen readers. */
export function AltTextBadge({ text }: { text: string }) {
  const { t } = useTranslation('media');
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('embed.altText')}
        className="absolute bottom-1.5 left-1.5 z-10 rounded-sm bg-black/75 px-1.5 py-0.5 text-caption font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={(event) => event.stopPropagation()}
      >
        ALT
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-w-72 text-label whitespace-pre-wrap">
        {text}
      </PopoverContent>
    </Popover>
  );
}
