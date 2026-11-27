export function formatFileSize(bytes: number, locale?: string): string {
  const number = (value: number, fractionDigits: number) => locale
    ? value.toLocaleString(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    : value.toFixed(fractionDigits);

  if (bytes < 1024) return `${number(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${number(bytes / (1024 * 1024), 1)} MB`;
  return `${number(bytes / (1024 * 1024 * 1024), 1)} GB`;
}
