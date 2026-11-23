export function widgetDuration(milliseconds: number, language: string): string {
  const minutes = Math.round(milliseconds / 60_000);
  const unit = minutes < 60 ? 'minute' : 'hour';
  return new Intl.NumberFormat(language, { style: 'unit', unit, maximumFractionDigits: 1 }).format(unit === 'hour' ? minutes / 60 : minutes);
}
