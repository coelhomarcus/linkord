import i18n from 'i18next';

const REPORT_CATEGORIES = [
  { value: 'spam' },
  { value: 'harassment' },
  { value: 'inappropriate' },
  { value: 'impersonation' },
  { value: 'illegal' },
  { value: 'other' },
] as const;

export const categoryLabel = (value: string): string => {
  const category = REPORT_CATEGORIES.find((c) => c.value === value)?.value;
  return category ? i18n.t(`reports:categories.${category}`) : value;
};
