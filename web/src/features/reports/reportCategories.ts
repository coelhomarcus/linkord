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
