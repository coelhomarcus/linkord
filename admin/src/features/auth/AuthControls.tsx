import { EyeIcon, EyeSlashIcon } from '@/shared/ui/icons';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-center gap-2 text-center">
      <h1 className="text-display font-semibold text-text-strong">{title}</h1>
      {subtitle && <p className="text-body text-text-secondary">{subtitle}</p>}
    </div>
  );
}

/** A link-styled button that moves between the signed-out steps. */
export function AuthLink({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cn('rounded-sm text-label font-medium text-link hover:underline focus-ring disabled:pointer-events-none disabled:opacity-50', className)}
    />
  );
}

export function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const { t } = useTranslation('auth');
  return (
    <button type="button" onClick={onToggle} aria-label={visible ? t('password.hide') : t('password.show')} className="rounded-lg focus-ring focus-visible:ring-inset">
      {visible ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
    </button>
  );
}
