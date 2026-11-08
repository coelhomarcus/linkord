import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SERVICE_BRANDS, connectionBrand, widgetBrand } from '@/features/profile/connectionBrands';
import { WIDGET_TYPES } from '@/features/profile/connectionsTypes';
import { BrandIcon } from '@/features/profile/profileLinks';

describe('service brands', () => {
  it('gives every service that has a widget an icon and a name', () => {
    for (const [provider, types] of Object.entries(WIDGET_TYPES)) {
      if (types.length === 0) continue;
      const brand = connectionBrand(provider as keyof typeof WIDGET_TYPES);
      expect(brand?.name).toBeTruthy();
      if (!brand) return;
      const { container } = render(<BrandIcon kind={brand.kind} />);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('names IGDB for the games widgets, which have no connection', () => {
    expect(SERVICE_BRANDS.igdb.name).toBe('IGDB');
    expect(widgetBrand({ connection: null })).toBe(SERVICE_BRANDS.igdb);
    expect(widgetBrand({ connection: { provider: 'github' } as never })).toBe(SERVICE_BRANDS.github);
    expect(widgetBrand({ connection: { provider: 'url' } as never })).toBeNull();
    const { container } = render(<BrandIcon kind={SERVICE_BRANDS.igdb.kind} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
