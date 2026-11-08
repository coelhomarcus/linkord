import { BrandIcon } from './profileLinks';
import type { ServiceBrand } from './connectionBrands';

/** The same title row on every Wall widget. A widget from a connected account links to that account with
 * the service's mark inside the badge; the games widgets have no account to link to. */
export function WidgetHeader({ title, account }: {
  title: string;
  account?: { brand: ServiceBrand; username: string; href: string; accessibleName: string };
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="min-w-0 truncate text-body font-semibold">{title}</h3>
      {account && (
        <a
          href={account.href}
          target="_blank"
          rel="noreferrer"
          aria-label={account.accessibleName}
          className="flex max-w-[55%] min-w-0 flex-none items-center gap-1.5 rounded-full bg-bg-tertiary px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="flex flex-none"><BrandIcon kind={account.brand.kind} size={14} /></span>
          <span aria-hidden className="truncate">@{account.username}</span>
        </a>
      )}
    </header>
  );
}
