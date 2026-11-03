import { i18n } from '@/shared/i18n/init';

export const REPORT_CATEGORIES = [
  { value: 'spam' },
  { value: 'harassment' },
  { value: 'inappropriate' },
  { value: 'impersonation' },
  { value: 'illegal' },
  { value: 'other' },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value'];
export type ReportTarget = { type: 'user' | 'server' | 'message'; id: string; label: string };

export const MAX_REPORT_DETAILS = 1000;

export const categoryLabel = (value: string): string => {
  const category = REPORT_CATEGORIES.find((c) => c.value === value)?.value;
  return category ? i18n.t(`reports:categories.${category}`) : value;
};
