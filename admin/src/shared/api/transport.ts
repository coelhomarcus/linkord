import i18n from 'i18next';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'api' });

export class ApiError extends Error {
  status: number;
  code: string;
  // only the friend-request cooldown response carries this
  retryAfter?: string;
  constructor(status: number, code: string, message: string, retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // Only when there IS a body — Fastify's default JSON parser 400s a
    // request that declares Content-Type: application/json but sends an
    // empty body (e.g. POST /api/auth/logout), which used to fail silently
    // (swallowed by AuthContext's logout() try/catch) and leave the real
    // session cookie alive on the server after a client-side "logout".
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try { body = await res.json(); } catch {  }

  if (!res.ok) {
    const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string; retryAfter?: string } }).error : null) || {};
    // expected 4xx answers (validation, cooldowns, denials) are normal control flow;
    // a server failure is worth a record, and a report
    if (res.status >= 500) log.error('API request failed', undefined, { path: path.split('?')[0], method: init?.method ?? 'GET', status: res.status, code: err.code });
    throw new ApiError(res.status, err.code || 'unknown_error', err.message || i18n.t('errors.unexpected'), err.retryAfter);
  }
  return body as T;
}

export interface LoginChallenge {
  challenge: string;
  /** the account email, masked (`a***@example.com`) */
  email: string;
}

/** `deletionCancelled`: this sign-in cancelled the account's scheduled deletion. */
