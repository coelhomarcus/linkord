import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from '../../http/cookies.js';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from './password.js';
import {
  createSession, resolveSession, destroySession, destroyOtherSessions, destroySessionById, listSessionsForUser,
} from './session.js';
import { dropSessionConnections } from './sessionConnections.js';
import { findByEmailLower, findById, findByUsernameLower, isValidEmail, normalizeEmail, privateUser } from '../users/users.js';
import { resolveLocale } from '../users/locale.js';
import { createUser, updateEmail, updatePassword, updateUsername } from './accounts.js';
import { invalidUsernameMessage, isReservedUsername, isValidUsername } from './usernameRules.js';
import { renameParticipants } from '../presence/participants.js';
import { checkRegistrationAllowed } from './registrationLimits.js';
import type { User } from '../../db/schema.js';
import { consumeLoginChallenge, findLoginChallenge, issueAuthCode, verifyAuthCode, type AuthCodePurpose } from './codes.js';
import { isEmailDeliveryConfigured, sendAuthCodeEmail } from './email.js';
import { isKnownBrowser, noticeLogin, noticeRegistration } from './loginAlert.js';
import { cancelScheduledDeletion, isPastDeletion, scheduleAccountDeletion } from './accountDeletion.js';
import { clientIpOf, sessionOriginOf } from '../../http/clientInfo.js';
import { recordAudit } from '../admin/auditLog.js';
import type { SessionUser } from '../../types.js';
import * as ratelimit from './ratelimit.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'auth' });

// /api/auth/* routes — registration closed behind an invite code, login,
// logout, and "who am I" (used by the frontend at boot to check if
// already logged in).

const ipOfRequest = clientIpOf;

// Code emails a person can ask for (a login code, a two-step setup code): a request limit, not a mistake
// limit, so a resend button cannot become a mail cannon.
const CODE_SEND_RULE: ratelimit.Rule = { windowMs: 15 * 60 * 1000, max: 5 };
// Asking whether a username is free, as a person types (debounced): enough for someone trying names, while a
// script listing accounts gets a few hundred names a day per account. Registration is behind an invite code, so
// accounts are not free to multiply.
const USERNAME_CHECK_BURST_RULE: ratelimit.Rule = { windowMs: 60 * 1000, max: 30 };
const USERNAME_CHECK_DAILY_RULE: ratelimit.Rule = { windowMs: 24 * 60 * 60 * 1000, max: 300 };
// Ending sessions from the list: generous for a person clicking, a ceiling for a script.
const SESSION_ACTION_RULE: ratelimit.Rule = { windowMs: 60 * 1000, max: 30 };
// A login challenge lives this long from its first code, however many times the code is resent.
const LOGIN_CHALLENGE_MAX_MS = 30 * 60 * 1000;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

// One counter of wrong codes per account, shared by the login's second step and the two-step setup:
// each code also allows only AUTH_CODE_MAX_ATTEMPTS, but a resend starts a new code, so this is what
// bounds guessing across codes (and it survives a restart, see ratelimit.ts).
const codeFailuresKey = (userId: string) => `code:${userId}`;
// Wrong password-reset codes. A person who only knows a username or an email can reach this, so it has its own
// counters: sharing `code:` would let anyone lock a victim out of the second step of their login. An unknown
// identifier gets a key too, so a block never tells an existing account from a missing one.
const resetFailuresKey = (userId: string | null, identifier: RecoveryIdentifier) =>
  userId ? `reset-code:${userId}` : `reset-code-unknown:${identifier.type}:${identifier.value.toLowerCase()}`;
// Stands in for a missing account wherever a lookup must cost the same as for a real one.
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';
// Wrong current passwords on the logged-in confirmations (two-step, password change).
const passwordConfirmKey = (userId: string) => `pw-confirm:${userId}`;

const hashChallenge = (challenge: string) => crypto.createHash('sha256').update(challenge).digest('hex');

/** `ana@gmail.com` → `a**@gmail.com`: enough to recognize the address on the login screen. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}${'*'.repeat(Math.max(2, at - 1))}${email.slice(at)}`;
}

function rateLimitedReply(reply: FastifyReply, retryAfterSec: number, message = 'Muitas tentativas. Tente novamente mais tarde.'): void {
  reply.header('Retry-After', String(retryAfterSec));
  sendError(reply, 429, 'rate_limited', message);
}

function auditActor(sess: SessionUser) {
  return { id: sess.userId, username: sess.username };
}

/** Constant-time compare even when lengths differ — timingSafeEqual throws
 * in that case, so we still spend an equal-length compare to avoid leaking
 * the correct code's length via timing. */
function safeCompare(a: unknown, b: unknown): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, rawToken: string): void {
  const cookie = serializeCookie(config.SESSION_COOKIE, rawToken, {
    maxAgeSec: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    secure: isSecureRequest(request.raw),
  });
  reply.header('Set-Cookie', cookie);
}

async function handleRegister(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // REGISTRATION_CODE is the only gate keeping a self-hosted instance
  // private — without a lockout here it's brute-forceable at unlimited
  // speed. Same IP-lockout scheme as login (see ratelimit.ts, stored in Postgres), but its own
  // key namespace so failed logins/registrations from one IP don't block
  // the other.
  const ipKey = `reg-ip:${ipOfRequest(request)}`;
  const ipBlockedSec = await ratelimit.checkBlocked(ipKey);
  if (ipBlockedSec) {
    reply.header('Retry-After', String(ipBlockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  const password = String(body.password == null ? '' : body.password);
  const confirmPassword = String(body.confirmPassword == null ? '' : body.confirmPassword);
  const code = String(body.code == null ? '' : body.code);

  // fail closed: no code configured means registration is closed — never
  // "open by a forgotten config."
  if (!config.REGISTRATION_CODE) return sendError(reply, 403, 'registration_closed', 'Registro fechado.');
  if (!safeCompare(code, config.REGISTRATION_CODE)) {
    await ratelimit.recordFailure(ipKey);
    log.warn('registration with a wrong invite code', { ip: ipKey });
    return sendError(reply, 403, 'invalid_code', 'Código de convite inválido.');
  }
  await ratelimit.reset(ipKey);

  if (!isValidUsername(username)) return sendError(reply, 400, 'invalid_username', invalidUsernameMessage());
  if (isReservedUsername(username)) {
    return sendError(reply, 409, 'username_taken', 'Esse nome de usuário ou e-mail já está em uso.');
  }
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (password.length < config.MIN_PASSWORD_LEN || password.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }
  if (confirmPassword !== password) {
    return sendError(reply, 400, 'password_mismatch', 'As senhas não coincidem.');
  }

  const gate = await checkRegistrationAllowed(ipOfRequest(request));
  if (gate !== 'ok') log.warn('registration refused', { gate, ip: ipOfRequest(request) });
  if (gate === 'paused') {
    reply.header('Retry-After', '900');
    return sendError(reply, 429, 'registration_paused', 'Muitos cadastros no momento. Tente novamente mais tarde.');
  }
  if (gate === 'ip_limited') {
    reply.header('Retry-After', '3600');
    return sendError(reply, 429, 'rate_limited', 'Muitos cadastros deste endereço. Tente novamente mais tarde.');
  }

  const passwordHash = await hashPassword(password);
  // never 'admin' from a sign-up: administrators are provisioned explicitly
  // (`npm run admin:grant`, or the /admin area) — a username is not a credential.
  const role = 'user';

  if (await findByEmailLower(email)) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');

  let user;
  try {
    user = await createUser({ username, email, passwordHash, role, locale: resolveLocale(body.locale) });
  } catch (err: unknown) {
    if (err && (err as { code?: string }).code === 'account_identity_taken') return sendError(reply, 409, 'username_taken', 'Esse nome de usuário ou e-mail já está em uso.');
    throw err;
  }

  const origin = sessionOriginOf(request);
  const { rawToken } = await createSession(user.id, origin);
  noticeRegistration(user.id, origin);
  setSessionCookie(request, reply, rawToken);
  log.info('account registered', { userId: user.id, username: user.username });
  // A new account has no friends or shared conversations, so scoped presence would deliver this
  // event to nobody.
  sendJson(reply, 201, { user: privateUser(user) });
}

async function handleLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ipKey = `ip:${ipOfRequest(request)}`;
  const ipBlockedSec = await ratelimit.checkBlocked(ipKey);
  if (ipBlockedSec) {
    reply.header('Retry-After', String(ipBlockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const password = String(body.password == null ? '' : body.password);
  const userKey = `user:${username.toLowerCase()}`;
  const userBlockedSec = await ratelimit.checkBlocked(userKey);

  const user = await findByUsernameLower(username);
  // Anyone can fill the account's counter from one address, so a blocked account still lets in the right
  // password from a browser it signed in from lately. Looked up before the password and for every name, so
  // neither the answer time nor the answer says whether the password or the account was right.
  const knownBrowser = userBlockedSec ? await isKnownBrowser(user?.id ?? NO_USER_ID, sessionOriginOf(request)) : false;
  // a nonexistent user still verifies against a fake hash, to spend the
  // same CPU time — and the response time doesn't reveal which usernames
  // exist. The error message is also IDENTICAL for both cases.
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);

  if (userBlockedSec && !(user && ok && knownBrowser)) {
    // Counted whether or not the password was right: the same work for both keeps this from telling them apart.
    await ratelimit.recordFailure(ipKey);
    await ratelimit.recordFailure(userKey);
    log.warn('login refused for a blocked account', { username, ip: ipOfRequest(request) });
    return rateLimitedReply(reply, userBlockedSec);
  }
  if (!user || !ok) {
    await ratelimit.recordFailure(ipKey);
    await ratelimit.recordFailure(userKey);
    log.warn('login failed', { username, ip: ipOfRequest(request) });
    return sendError(reply, 401, 'invalid_credentials', 'Usuário ou senha inválidos.');
  }

  // The address key is left to expire with its window: anyone holding one valid account could otherwise
  // wipe their address's count between rounds and spray every username. A blocked account keeps its block
  // when its owner gets through it, or each of their logins would hand the attacker a fresh round. A
  // failure to clear the account's counter must not turn a right password into a refused login.
  if (!userBlockedSec) await ratelimit.reset(userKey).catch(() => {});

  // only reachable with the right password, so it leaks nothing about who exists
  if (user.status !== 'active') {
    log.warn('login refused for a suspended account', { userId: user.id, username: user.username });
    return sendError(reply, 403, 'account_unavailable', 'Esta conta está indisponível. Fale com a administração.');
  }
  if (isPastDeletion(user)) return accountDeletedError(reply);

  if (needsRehash(user.passwordHash)) {
    hashPassword(password)
      .then((newHash) => db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, user.id)))
      .catch(() => {});
  }

  if (user.twoFactorEmail) return startLoginChallenge(reply, user);

  const origin = sessionOriginOf(request);
  const { rawToken } = await createSession(user.id, origin);
  noticeLogin(user, origin);
  setSessionCookie(request, reply, rawToken);
  log.info('login', { userId: user.id, username: user.username });
  sendJson(reply, 200, await signedIn(request, user));
}

/** The answer to a sign-in that created a session. Signing in is what cancels a scheduled deletion, and
 * the answer says so, for the client to tell the person. */
async function signedIn(request: FastifyRequest, user: User): Promise<{ user: ReturnType<typeof privateUser>; deletionCancelled?: true }> {
  const cancelled = await cancelScheduledDeletion({ id: user.id, username: user.username }, request.id);
  return cancelled ? { user: privateUser(user), deletionCancelled: true } : { user: privateUser(user) };
}

function accountDeletedError(reply: FastifyReply): void {
  sendError(reply, 403, 'account_deleted', 'Esta conta foi excluída a pedido do titular.');
}

/** The right password with two-step login on: no session yet, a code to the account's email and a
 * challenge the browser holds until it sends the code back. Only reachable with the right password,
 * so the answer reveals nothing about which accounts exist. */
async function startLoginChallenge(reply: FastifyReply, user: User): Promise<void> {
  if (!user.email || !isEmailDeliveryConfigured()) {
    log.error('two-step login cannot send its code', { userId: user.id, hasEmail: Boolean(user.email) });
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  const send = await ratelimit.consume(`login-code:${user.id}`, CODE_SEND_RULE);
  if (!send.allowed) return rateLimitedReply(reply, send.retryAfterSec, 'Muitos códigos enviados. Tente novamente mais tarde.');

  const challenge = crypto.randomBytes(32).toString('base64url');
  try {
    await issueAndSendCode(user.id, user.email, user.username, 'login', resolveLocale(user.locale), hashChallenge(challenge));
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  log.info('login waiting for its emailed code', { userId: user.id });
  sendJson(reply, 200, { twoFactor: { challenge, email: maskEmail(user.email) } });
}

type ChallengeLookup = { user: User; challengeHash: string } | { refused: true };

/** Resolves the challenge of a login's second step, answering the request itself when it cannot go on. */
async function loginChallengeFor(request: FastifyRequest, reply: FastifyReply, challenge: string): Promise<ChallengeLookup> {
  const ipKey = `ip:${ipOfRequest(request)}`;
  const ipBlockedSec = await ratelimit.checkBlocked(ipKey);
  if (ipBlockedSec) { rateLimitedReply(reply, ipBlockedSec); return { refused: true }; }

  const expired = (): ChallengeLookup => {
    sendError(reply, 400, 'login_expired', 'O login expirou. Entre com sua senha de novo.');
    return { refused: true };
  };
  if (!CHALLENGE_RE.test(challenge)) return expired();
  const challengeHash = hashChallenge(challenge);
  const found = await findLoginChallenge(challengeHash);
  if (!found || found.startedAt.getTime() + LOGIN_CHALLENGE_MAX_MS < Date.now()) return expired();
  const user = await findById(found.userId);
  if (!user || !user.email) return expired();
  if (user.status !== 'active') {
    sendError(reply, 403, 'account_unavailable', 'Esta conta está indisponível. Fale com a administração.');
    return { refused: true };
  }
  if (isPastDeletion(user)) {
    accountDeletedError(reply);
    return { refused: true };
  }
  return { user, challengeHash };
}

async function handleLoginVerify(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const challenge = String(body.challenge == null ? '' : body.challenge);
  const code = String(body.code == null ? '' : body.code).trim();
  const lookup = await loginChallengeFor(request, reply, challenge);
  if ('refused' in lookup) return;
  const { user, challengeHash } = lookup;
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');

  const userKey = codeFailuresKey(user.id);
  const blocked = await ratelimit.checkBlocked(userKey);
  if (blocked) return rateLimitedReply(reply, blocked);

  const result = await verifyAuthCode(user.id, 'login', user.email!, code, { challengeHash });
  if (!result.ok) {
    if (result.reason === 'invalid_code' || result.reason === 'too_many_attempts') {
      await ratelimit.recordFailure(`ip:${ipOfRequest(request)}`);
      await ratelimit.recordFailure(userKey);
    }
    log.warn('login code refused', { userId: user.id, reason: result.reason, ip: ipOfRequest(request) });
    return purposeError(reply, result.reason);
  }

  await consumeLoginChallenge(challengeHash);
  await ratelimit.reset(userKey).catch(() => {});
  const origin = sessionOriginOf(request);
  const { rawToken } = await createSession(user.id, origin);
  noticeLogin(user, origin);
  setSessionCookie(request, reply, rawToken);
  log.info('login', { userId: user.id, username: user.username, twoFactor: true });
  sendJson(reply, 200, await signedIn(request, user));
}

async function handleLoginResend(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const lookup = await loginChallengeFor(request, reply, String(body.challenge == null ? '' : body.challenge));
  if ('refused' in lookup) return;
  const { user, challengeHash } = lookup;
  const send = await ratelimit.consume(`login-code:${user.id}`, CODE_SEND_RULE);
  if (!send.allowed) return rateLimitedReply(reply, send.retryAfterSec, 'Muitos códigos enviados. Tente novamente mais tarde.');
  try {
    await issueAndSendCode(user.id, user.email!, user.username, 'login', resolveLocale(user.locale), challengeHash);
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { ok: true });
}

async function handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const tokenHash = await destroySession(cookies[config.SESSION_COOKIE]);
  if (tokenHash) dropSessionConnections([tokenHash]);
  reply.header('Set-Cookie', clearCookie(config.SESSION_COOKIE, { secure: isSecureRequest(request.raw) }));
  reply.code(204).header('Cache-Control', 'no-store').send();
}

async function handleMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, {
    user: {
      id: sess.userId,
      username: sess.username,
      email: sess.email,
      displayName: sess.displayName,
      avatar: sess.avatar,
      avatarColor: sess.avatarColor,
      banner: sess.banner,
      bio: sess.bio,
      profileLinks: sess.profileLinks,
      role: sess.role,
      locale: sess.locale,
    },
  });
}

function purposeError(reply: FastifyReply, reason: 'invalid_code' | 'code_expired' | 'too_many_attempts'): void {
  const messages = {
    invalid_code: 'Código inválido.',
    code_expired: 'Código expirado. Solicite um novo código.',
    too_many_attempts: 'Limite de tentativas atingido. Solicite um novo código.',
  } as const;
  sendError(reply, 400, reason, messages[reason]);
}

function sessionForRequest(request: FastifyRequest) {
  const cookies = parseCookies(request.headers.cookie || '');
  return resolveSession(cookies[config.SESSION_COOKIE]);
}

async function issueAndSendCode(
  userId: string, email: string, username: string, purpose: AuthCodePurpose, locale: ReturnType<typeof resolveLocale>, challengeHash?: string,
): Promise<void> {
  const code = await issueAuthCode(userId, purpose, email, challengeHash ? { challengeHash, ttlMs: config.LOGIN_CODE_TTL_MS } : {});
  try {
    await sendAuthCodeEmail({ to: email, code, purpose, username, locale });
  } catch (err) {
    log.error('failed to send code', err);
    throw err;
  }
}

// Recovery accepts either identifier — whichever the user still remembers.
// Resolved to a DB user without ever leaking which of the two exists (same
// generic { ok: true } response either way), and the code is always issued
// to the account's actual email on file, never to whatever the client typed.
type RecoveryIdentifier = { type: 'username'; value: string } | { type: 'email'; value: string };

function parseRecoveryIdentifier(body: Record<string, unknown>): RecoveryIdentifier | null {
  const rawUsername = body.username == null ? '' : String(body.username).trim();
  if (rawUsername) return { type: 'username', value: rawUsername };
  const rawEmail = body.email == null ? '' : String(body.email);
  if (rawEmail) return { type: 'email', value: normalizeEmail(rawEmail) };
  return null;
}

function findUserByIdentifier(id: RecoveryIdentifier): Promise<User | null> {
  return id.type === 'username' ? findByUsernameLower(id.value) : findByEmailLower(id.value);
}

async function handleRecoveryRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const identifier = parseRecoveryIdentifier(body);
  if (!identifier) return sendError(reply, 400, 'invalid_email', 'Informe seu usuário ou e-mail.');
  if (identifier.type === 'email' && !isValidEmail(identifier.value)) {
    return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  }
  if (identifier.type === 'username' && !isValidUsername(identifier.value)) {
    return sendError(reply, 400, 'invalid_email', 'Informe um nome de usuário válido.');
  }

  // Only the address is limited per request. Nothing keyed on the name someone typed may refuse a request:
  // anyone could fill it and keep the owner from ever getting a code.
  const ipKey = `recovery-ip:${ipOfRequest(request)}`;
  const blocked = await ratelimit.checkBlocked(ipKey);
  if (blocked) {
    reply.header('Retry-After', String(blocked));
    return sendError(reply, 429, 'rate_limited', 'Muitas solicitações. Tente novamente mais tarde.');
  }
  await ratelimit.recordFailure(ipKey);

  const user = await findUserByIdentifier(identifier);
  // Counted per account and only where a code goes out, so asking by username and by email does not double
  // the codes. A browser the account signed in from lately has a budget of its own, which strangers asking
  // for this account cannot spend. A refusal looks like success: a 429 would only exist for real accounts.
  if (user?.email) {
    const known = await isKnownBrowser(user.id, sessionOriginOf(request));
    const send = await ratelimit.consume(`${known ? 'recovery-account-known' : 'recovery-account'}:${user.id}`, CODE_SEND_RULE);
    if (send.allowed) {
      try {
        await issueAndSendCode(user.id, user.email, user.username, 'password_reset', resolveLocale(user.locale));
      } catch { /* Keep the response identical so recovery never enumerates accounts. */ }
    }
  }
  sendJson(reply, 200, { ok: true });
}

async function handleRecoveryReset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const identifier = parseRecoveryIdentifier(body);
  const code = String(body.code == null ? '' : body.code).trim();
  const password = String(body.password == null ? '' : body.password);
  if (!identifier) return sendError(reply, 400, 'invalid_email', 'Informe seu usuário ou e-mail.');
  if (identifier.type === 'email' && !isValidEmail(identifier.value)) {
    return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  }
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  if (password.length < config.MIN_PASSWORD_LEN || password.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }

  // A resend starts a new code with a fresh per-code budget, so the guesses are also counted per account
  // (however it was named: username or email) and per address, which is what bounds them across codes.
  const ipKey = `reset-ip:${ipOfRequest(request)}`;
  const user = await findUserByIdentifier(identifier);
  const accountKey = resetFailuresKey(user?.id ?? null, identifier);
  const ipBlocked = await ratelimit.checkBlocked(ipKey);
  if (ipBlocked) return rateLimitedReply(reply, ipBlocked);
  // Anyone who knows the username can fill the account's counter, so a browser the account signed in from
  // lately still gets to try its code; its guesses stay bounded by the address counter and the code's own tries.
  const accountBlocked = await ratelimit.checkBlocked(accountKey);
  const accountBlockedHere = accountBlocked && !(await isKnownBrowser(user?.id ?? NO_USER_ID, sessionOriginOf(request)));
  if (accountBlockedHere) return rateLimitedReply(reply, accountBlocked);

  const result = user?.email ? await verifyAuthCode(user.id, 'password_reset', user.email, code) : null;
  if (!user || !result?.ok) {
    const reason = result && !result.ok ? result.reason : 'invalid_code';
    if (reason === 'invalid_code' || reason === 'too_many_attempts') {
      await ratelimit.recordFailure(ipKey);
      await ratelimit.recordFailure(accountKey);
    }
    log.warn('password reset code refused', { userId: user?.id, reason, ip: ipOfRequest(request) });
    return purposeError(reply, reason);
  }
  if (!accountBlocked) await ratelimit.reset(accountKey).catch(() => {});

  await updatePassword(user.id, await hashPassword(password));
  // whoever knew the old password is signed out everywhere, live sockets included
  dropSessionConnections(await destroyOtherSessions(user.id, ''));
  await recordAudit({ actor: { id: user.id, username: user.username }, action: 'account.password_reset', targetType: 'user', targetId: user.id, targetLabel: user.username, requestId: request.id });
  sendJson(reply, 200, { ok: true });
}

async function handleEmailChangeRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  // Asked before anything else, so a stolen session cannot probe which addresses are taken, and cannot
  // point the account's recovery at an address of its own, which would bypass the password checks.
  if (!(await confirmPassword(reply, sess, String(body.password == null ? '' : body.password)))) return;
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (sess.email && normalizeEmail(sess.email) === email) return sendError(reply, 400, 'same_email', 'Informe um e-mail diferente do atual.');
  const existing = await findByEmailLower(email);
  if (existing && existing.id !== sess.userId) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');
  const changeKey = `email-change:${sess.userId}`;
  const blocked = await ratelimit.checkBlocked(changeKey);
  if (blocked) {
    reply.header('Retry-After', String(blocked));
    return sendError(reply, 429, 'rate_limited', 'Muitas solicitações. Tente novamente mais tarde.');
  }
  await ratelimit.recordFailure(changeKey);
  try {
    await issueAndSendCode(sess.userId, email, sess.username, 'email_change', resolveLocale(sess.locale));
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { ok: true });
}

async function handleEmailChangeConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  const code = String(body.code == null ? '' : body.code).trim();
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  const result = await verifyAuthCode(sess.userId, 'email_change', email, code);
  if (!result.ok) return purposeError(reply, result.reason);
  const existing = await findByEmailLower(email);
  if (existing && existing.id !== sess.userId) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');
  const user = await updateEmail(sess.userId, email);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  sendJson(reply, 200, { user: privateUser(user) });
}

// ---- username: the login name, unique in any letter case (users_username_lower_key) ----

/** Whether `username` is free for this account. Its own name, in any letter case, is free: changing only the
 * case is a rename like any other. Reserved names read as taken. */
async function usernameAvailableFor(userId: string, username: string): Promise<boolean> {
  if (isReservedUsername(username)) return false;
  const existing = await findByUsernameLower(username);
  return !existing || existing.id === userId;
}

async function handleUsernameAvailability(request: FastifyRequest<{ Querystring: { username?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const username = String(request.query.username ?? '').trim();
  if (!isValidUsername(username)) return sendError(reply, 400, 'invalid_username', invalidUsernameMessage());
  // Counted only for well-formed names, the ones that reach the database. The daily window is consumed first so
  // a refused burst still counts toward the day.
  for (const [key, rule] of [[`username-check-day:${sess.userId}`, USERNAME_CHECK_DAILY_RULE], [`username-check:${sess.userId}`, USERNAME_CHECK_BURST_RULE]] as const) {
    const verdict = await ratelimit.consume(key, rule);
    if (!verdict.allowed) return rateLimitedReply(reply, verdict.retryAfterSec);
  }
  sendJson(reply, 200, {
    username,
    available: await usernameAvailableFor(sess.userId, username),
    current: username === sess.username,
  });
}

async function handleUsernameChange(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  if (!isValidUsername(username)) return sendError(reply, 400, 'invalid_username', invalidUsernameMessage());
  // The password before the lookup, as with the email: a stolen session cannot rename the account, which would
  // also lock its owner out of signing in by name.
  if (!(await confirmPassword(reply, sess, String(body.password == null ? '' : body.password)))) return;
  const before = await findById(sess.userId);
  if (!before) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  if (before.username === username) return sendJson(reply, 200, { user: privateUser(before) });
  if (!(await usernameAvailableFor(sess.userId, username))) return sendError(reply, 409, 'username_taken', 'Esse nome de usuário já está em uso.');
  let user;
  try {
    user = await updateUsername(sess.userId, username);
  } catch (err: unknown) {
    if ((err as { code?: string } | undefined)?.code === 'username_taken') return sendError(reply, 409, 'username_taken', 'Esse nome de usuário já está em uso.');
    throw err;
  }
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  renameParticipants(user.id, user.username);
  await recordAudit({
    actor: { id: sess.userId, username: user.username }, action: 'account.username_change', targetType: 'user', targetId: sess.userId,
    targetLabel: user.username, detail: { from: before.username, to: user.username }, requestId: request.id,
  });
  log.info('username changed', { userId: sess.userId, from: before.username, to: user.username });
  sendJson(reply, 200, { user: privateUser(user) });
}

// ---- account security: the logged-in person's own sessions, password and two-step login ----

/** Checks the current password asked for before a sensitive change, under its own attempt counter.
 * Answers the request itself (and returns false) when it is wrong or blocked. */
async function confirmPassword(reply: FastifyReply, sess: SessionUser, password: string): Promise<boolean> {
  const key = passwordConfirmKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) { rateLimitedReply(reply, blocked); return false; }
  const user = await findById(sess.userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await ratelimit.recordFailure(key);
    log.warn('wrong current password on a security change', { userId: sess.userId });
    sendError(reply, 403, 'invalid_password', 'Senha incorreta.');
    return false;
  }
  await ratelimit.reset(key).catch(() => {});
  return true;
}

async function handleSecurityStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const user = await findById(sess.userId);
  if (!user) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, {
    twoFactorEnabled: user.twoFactorEmail,
    loginAlertEnabled: user.loginAlertEmail,
    emailDeliveryAvailable: isEmailDeliveryConfigured(),
    hasEmail: Boolean(user.email),
    sessionIdleDays: config.SESSION_IDLE_DAYS,
  });
}

async function handleTwoFactorEnableRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  if (!sess.email) return sendError(reply, 409, 'email_required', 'Adicione um e-mail à conta antes de ativar a verificação em duas etapas.');
  if (!isEmailDeliveryConfigured()) {
    return sendError(reply, 503, 'email_not_configured', 'O envio de e-mails não está configurado neste servidor, então a verificação em duas etapas não pode ser ativada.');
  }
  if (!(await confirmPassword(reply, sess, String(body.password == null ? '' : body.password)))) return;
  const send = await ratelimit.consume(`2fa-setup:${sess.userId}`, CODE_SEND_RULE);
  if (!send.allowed) return rateLimitedReply(reply, send.retryAfterSec, 'Muitos códigos enviados. Tente novamente mais tarde.');
  try {
    await issueAndSendCode(sess.userId, sess.email, sess.username, 'two_factor_setup', resolveLocale(sess.locale));
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { ok: true });
}

async function handleTwoFactorEnableConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!sess.email) return sendError(reply, 409, 'email_required', 'Adicione um e-mail à conta antes de ativar a verificação em duas etapas.');
  const code = String(jsonBody(request.body).code ?? '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  const key = codeFailuresKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) return rateLimitedReply(reply, blocked);
  const result = await verifyAuthCode(sess.userId, 'two_factor_setup', sess.email, code);
  if (!result.ok) {
    if (result.reason !== 'code_expired') await ratelimit.recordFailure(key);
    return purposeError(reply, result.reason);
  }
  await ratelimit.reset(key).catch(() => {});
  await db.update(users).set({ twoFactorEmail: true, updatedAt: new Date() }).where(eq(users.id, sess.userId));
  await recordAudit({ actor: auditActor(sess), action: 'account.two_factor_enable', targetType: 'user', targetId: sess.userId, targetLabel: sess.username, requestId: request.id });
  log.info('two-step login turned on', { userId: sess.userId });
  sendJson(reply, 200, { twoFactorEnabled: true });
}

async function handleTwoFactorDisable(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!(await confirmPassword(reply, sess, String(jsonBody(request.body).password ?? '')))) return;
  await db.update(users).set({ twoFactorEmail: false, updatedAt: new Date() }).where(eq(users.id, sess.userId));
  await recordAudit({ actor: auditActor(sess), action: 'account.two_factor_disable', targetType: 'user', targetId: sess.userId, targetLabel: sess.username, requestId: request.id });
  log.info('two-step login turned off', { userId: sess.userId });
  sendJson(reply, 200, { twoFactorEnabled: false });
}

async function handleLoginAlertSet(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const enabled = jsonBody(request.body).enabled;
  if (typeof enabled !== 'boolean') return sendError(reply, 400, 'invalid_request', 'Informe se o aviso deve ficar ativo.');
  await db.update(users).set({ loginAlertEmail: enabled, updatedAt: new Date() }).where(eq(users.id, sess.userId));
  log.info('login alerts changed', { userId: sess.userId, enabled });
  sendJson(reply, 200, { loginAlertEnabled: enabled });
}

async function handlePasswordChange(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const newPassword = String(body.newPassword == null ? '' : body.newPassword);
  if (newPassword.length < config.MIN_PASSWORD_LEN || newPassword.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }
  if (!(await confirmPassword(reply, sess, String(body.currentPassword == null ? '' : body.currentPassword)))) return;
  await updatePassword(sess.userId, await hashPassword(newPassword));
  // this device stays signed in; every other one learns the password changed by being signed out
  const ended = await destroyOtherSessions(sess.userId, sess.tokenHash);
  dropSessionConnections(ended);
  await recordAudit({
    actor: auditActor(sess), action: 'account.password_change', targetType: 'user', targetId: sess.userId, targetLabel: sess.username,
    detail: { endedSessions: ended.length }, requestId: request.id,
  });
  log.info('password changed', { userId: sess.userId, endedSessions: ended.length });
  sendJson(reply, 200, { endedSessions: ended.length });
}

async function handleListSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const list = await listSessionsForUser(sess.userId);
  sendJson(reply, 200, {
    sessions: list.map((s) => ({
      id: s.id, current: s.id === sess.sessionId, ip: s.ip, userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
    })),
  });
}

async function sessionActionAllowed(reply: FastifyReply, sess: SessionUser): Promise<boolean> {
  const verdict = await ratelimit.consume(`session-action:${sess.userId}`, SESSION_ACTION_RULE);
  if (!verdict.allowed) rateLimitedReply(reply, verdict.retryAfterSec);
  return verdict.allowed;
}

async function handleEndSession(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const id = String(request.params.id || '');
  // this device leaves through logout, which also clears its cookie
  if (id === sess.sessionId) return sendError(reply, 400, 'invalid_target', 'Para encerrar esta sessão, saia da conta.');
  if (!(await sessionActionAllowed(reply, sess))) return;
  const tokenHash = await destroySessionById(sess.userId, id);
  if (!tokenHash) return sendError(reply, 404, 'not_found', 'Sessão não encontrada.');
  dropSessionConnections([tokenHash]);
  await recordAudit({
    actor: auditActor(sess), action: 'account.session_end', targetType: 'user', targetId: sess.userId, targetLabel: sess.username,
    detail: { sessionId: id }, requestId: request.id,
  });
  reply.code(204).header('Cache-Control', 'no-store').send();
}

async function handleEndOtherSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!(await sessionActionAllowed(reply, sess))) return;
  const ended = await destroyOtherSessions(sess.userId, sess.tokenHash);
  dropSessionConnections(ended);
  await recordAudit({
    actor: auditActor(sess), action: 'account.sessions_end_others', targetType: 'user', targetId: sess.userId, targetLabel: sess.username,
    detail: { endedSessions: ended.length }, requestId: request.id,
  });
  sendJson(reply, 200, { endedSessions: ended.length });
}

// ---- deleting your own account (accountDeletion.ts): password, then the emailed code with two-step login on ----

/** Schedules the deletion and answers with its date. The account's sessions, this one included, are
 * gone, so the cookie is cleared too. */
async function finishDeletionRequest(request: FastifyRequest, reply: FastifyReply, sess: SessionUser): Promise<void> {
  const result = await scheduleAccountDeletion(auditActor(sess), request.id);
  if (result.code === 'last_admin') {
    return sendError(reply, 409, 'last_admin', 'Você é o único administrador. Torne outra pessoa administradora antes de excluir sua conta.');
  }
  if (result.code !== 'ok') return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  reply.header('Set-Cookie', clearCookie(config.SESSION_COOKIE, { secure: isSecureRequest(request.raw) }));
  sendJson(reply, 200, { deletionDueAt: result.dueAt.toISOString() });
}

async function handleDeletionRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!(await confirmPassword(reply, sess, String(jsonBody(request.body).password ?? '')))) return;
  const user = await findById(sess.userId);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  if (!user.twoFactorEmail) return finishDeletionRequest(request, reply, sess);

  // with two-step login on, the password alone is not enough to delete the account: a code to its email
  if (!user.email || !isEmailDeliveryConfigured()) {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  const send = await ratelimit.consume(`deletion-code:${sess.userId}`, CODE_SEND_RULE);
  if (!send.allowed) return rateLimitedReply(reply, send.retryAfterSec, 'Muitos códigos enviados. Tente novamente mais tarde.');
  try {
    await issueAndSendCode(user.id, user.email, user.username, 'account_deletion', resolveLocale(user.locale));
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código de verificação agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { codeRequired: true, email: maskEmail(user.email) });
}

async function handleDeletionConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!sess.email) return sendError(reply, 400, 'invalid_code', 'Código inválido.');
  const code = String(jsonBody(request.body).code ?? '').trim();
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  const key = codeFailuresKey(sess.userId);
  const blocked = await ratelimit.checkBlocked(key);
  if (blocked) return rateLimitedReply(reply, blocked);
  // a code is only ever issued after the password was confirmed, so it stands for both steps
  const result = await verifyAuthCode(sess.userId, 'account_deletion', sess.email, code);
  if (!result.ok) {
    if (result.reason !== 'code_expired') await ratelimit.recordFailure(key);
    return purposeError(reply, result.reason);
  }
  await ratelimit.reset(key).catch(() => {});
  return finishDeletionRequest(request, reply, sess);
}

export function registerAuthRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/register', handleRegister);
  fastify.post('/api/auth/login', handleLogin);
  fastify.post('/api/auth/login/verify', handleLoginVerify);
  fastify.post('/api/auth/login/resend', handleLoginResend);
  fastify.post('/api/auth/logout', handleLogout);
  fastify.get('/api/auth/me', handleMe);
  fastify.post('/api/auth/recovery/request', handleRecoveryRequest);
  fastify.post('/api/auth/recovery/reset', handleRecoveryReset);
  fastify.post('/api/auth/email/change/request', handleEmailChangeRequest);
  fastify.post('/api/auth/email/change/confirm', handleEmailChangeConfirm);
  fastify.get<{ Querystring: { username?: string } }>('/api/auth/username/availability', handleUsernameAvailability);
  fastify.post('/api/auth/username', handleUsernameChange);
  fastify.get('/api/auth/security', handleSecurityStatus);
  fastify.post('/api/auth/two-factor/enable/request', handleTwoFactorEnableRequest);
  fastify.post('/api/auth/two-factor/enable/confirm', handleTwoFactorEnableConfirm);
  fastify.post('/api/auth/two-factor/disable', handleTwoFactorDisable);
  fastify.put('/api/auth/login-alerts', handleLoginAlertSet);
  fastify.post('/api/auth/password', handlePasswordChange);
  fastify.get('/api/auth/sessions', handleListSessions);
  fastify.post('/api/auth/sessions/end-others', handleEndOtherSessions);
  fastify.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', handleEndSession);
  fastify.post('/api/auth/account/deletion/request', handleDeletionRequest);
  fastify.post('/api/auth/account/deletion/confirm', handleDeletionConfirm);
}
