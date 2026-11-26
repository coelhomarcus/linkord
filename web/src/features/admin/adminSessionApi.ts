import { apiFetch } from '@/shared/api/api';
import type { LoginChallenge } from '@/shared/api/api';
import type { Language } from '@/shared/i18n/languages';

export interface AdminIdentity {
  id: string;
  username: string;
  locale: Language;
}

type SignedIn = { user: AdminIdentity };
const AUTH = '/api/admin/auth';

export const fetchAdminSession = () => apiFetch<SignedIn>(`${AUTH}/me`);
export const loginAdmin = (username: string, password: string) =>
  apiFetch<SignedIn | { twoFactor: LoginChallenge }>(`${AUTH}/login`, { method: 'POST', body: JSON.stringify({ username, password }) });
export const verifyAdminCode = (challenge: string, code: string) =>
  apiFetch<SignedIn>(`${AUTH}/login/verify`, { method: 'POST', body: JSON.stringify({ challenge, code }) });
export const resendAdminCode = (challenge: string) =>
  apiFetch<void>(`${AUTH}/login/resend`, { method: 'POST', body: JSON.stringify({ challenge }) });
export const logoutAdmin = () => apiFetch<void>(`${AUTH}/logout`, { method: 'POST' });
