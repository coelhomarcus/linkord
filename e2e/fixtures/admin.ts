import { ADMIN_URL, emailCount, waitForEmailCode } from '../stack/stack';
import { expect, type User } from './test';

export const emailOf = (user: User) => `${user.username}@example.test`;

export async function enableTwoFactor(user: User) {
  const email = emailOf(user);
  const seen = await emailCount(email);
  const request = await user.api.post('/api/auth/two-factor/enable/request', { data: { password: user.password } });
  expect(request.ok(), await request.text()).toBe(true);
  const confirm = await user.api.post('/api/auth/two-factor/enable/confirm', { data: { code: await waitForEmailCode(email, seen) } });
  expect(confirm.ok(), await confirm.text()).toBe(true);
}

export async function signInAdminThroughApi(user: User) {
  const email = emailOf(user);
  const seen = await emailCount(email);
  const headers = { origin: ADMIN_URL };
  const login = await user.api.post(`${ADMIN_URL}/api/admin/auth/login`, { headers, data: { username: user.username, password: user.password } });
  expect(login.ok(), await login.text()).toBe(true);
  const { twoFactor } = await login.json() as { twoFactor: { challenge: string } };
  const verify = await user.api.post(`${ADMIN_URL}/api/admin/auth/login/verify`, {
    headers, data: { challenge: twoFactor.challenge, code: await waitForEmailCode(email, seen) },
  });
  expect(verify.ok(), await verify.text()).toBe(true);
}
