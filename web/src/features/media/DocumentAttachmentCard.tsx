import { formatFileSize } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useTranslation } from 'react-i18next';
import { presentFile } from './filePresentation';

interface DocumentAttachmentCardProps {
  name: string;
  size: number;
  mime: string;
  className?: string;
}

/** Standardized file identity — icon by family, name with space reserved for
 * the extension, type and size. Used by the draft tray, the
 * pending (outbox) chip and the published card, so a document reads the
 * same everywhere in the app. No download control, no card chrome: those
 * belong to whichever surface wraps this (see FileAttachmentCard). */
export function DocumentAttachmentCard({ name, size, mime, className }: DocumentAttachmentCardProps) {
  const { t } = useTranslation('media');
  const { icon: Icon, iconBgClassName, iconTextClassName, badge, typeLabelKey, baseName, extension } = presentFile(name, mime);
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div className={cn('relative grid size-10 flex-none place-items-center rounded-md', iconBgClassName)}>
        <Icon size={20} className={iconTextClassName} />
        {badge && (
          // off-scale: part of the file icon, sized to its 40px box
          <span className="absolute -bottom-1 -right-1 rounded-sm bg-red px-1 text-[9px] font-bold leading-3.5 text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p title={name} className="flex min-w-0 items-baseline text-label font-medium text-text-secondary">
          <span className="truncate">{baseName}</span>
          {extension && <span className="max-w-1/2 flex-none truncate">.{extension}</span>}
        </p>
        <p className="truncate text-caption text-text-muted">
          {t(`fileTypes.${typeLabelKey}`)} · {formatFileSize(size)}
        </p>
      </div>
    </div>
  );
}
