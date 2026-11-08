import { BrandIcon } from './profileLinks';
import type { ServiceBrand } from './connectionBrands';

/** The same title row on every Wall widget: the service mark, then a link to where the data comes from. */
export function WidgetHeader({ title, brand, link }: {
  title: string;
  brand: ServiceBrand;
  link: { label: string; href: string; accessibleName: string };
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="flex min-w-0 items-center gap-2 text-body font-semibold">
        <span aria-hidden className="flex flex-none text-text-primary"><BrandIcon kind={brand.kind} size={16} /></span>
        <span className="truncate">{title}</span>
      </h3>
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        aria-label={link.accessibleName}
        className="max-w-[55%] min-w-0 flex-none truncate rounded-full bg-bg-tertiary px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="truncate">{link.label}</span>
      </a>
    </header>
  );
}
