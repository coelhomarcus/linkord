import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { BASE_URL, registrationCode } from '../stack/stack';
import { AppPage } from './app';

export interface User {
  id: string;
  username: string;
  password: string;
  context: BrowserContext;
  api: APIRequestContext;
  /** the user's first tab, opened on demand */
  page(): Promise<Page>;
  /** the same tab, wrapped with the app helpers */
  app(): Promise<AppPage>;
  /** another tab of the same account (its own socket, like a second window) */
  newTab(path?: string): Promise<AppPage>;
}

/** `phone`: the context is a touch phone (390x844, touch, mobile), so `(hover: none)` and
 * `(pointer: coarse)` match and the app shows its compact layout. */
export interface DeviceOptions { device?: 'desktop' | 'phone' }

export interface Users {
  /** A fresh account in its own browser context (own cookies, own storage),
   * registered through the real sign-up route. */
  create(prefix?: string, options?: DeviceOptions): Promise<User>;
  /** A context for an account that already exists, logged in through the real form. */
  login(username: string, password: string): Promise<User>;
}

async function newContext(browser: Browser, { device = 'desktop' }: DeviceOptions = {}): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    locale: 'pt-BR',
    permissions: ['microphone', 'camera'],
    ...(device === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
}

function wrap(id: string, username: string, password: string, context: BrowserContext): User {
  // The helpers listen to the page's socket and console, so they are attached
  // before the first navigation: the app connects as soon as it loads.
  let first: AppPage | null = null;
  const open = async (path: string) => {
    const app = new AppPage(await context.newPage());
    await app.page.goto(path);
    return app;
  };
  const app = async () => {
    first ??= await open('/app');
    return first;
  };
  return {
    id, username, password, context, api: context.request,
    page: async (): Promise<Page> => (await app()).page,
    app,
    newTab: open,
  };
}

export const test = base.extend<{ users: Users }>({
  users: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use({
      async create(prefix = 'u', options) {
        const context = await newContext(browser, options);
        contexts.push(context);
        const username = `${prefix.slice(0, 8)}${randomBytes(4).toString('hex')}`;
        const password = randomBytes(12).toString('hex');
        const response = await context.request.post('/api/auth/register', {
          data: { username, email: `${username}@example.test`, password, confirmPassword: password, code: registrationCode() },
        });
        if (!response.ok()) throw new Error(`register ${username}: HTTP ${response.status()} ${await response.text()}`);
        const { user } = await response.json() as { user: { id: string } };
        return wrap(user.id, username, password, context);
      },
      async login(username, password) {
        const context = await newContext(browser);
        contexts.push(context);
        const response = await context.request.post('/api/auth/login', { data: { username, password } });
        if (!response.ok()) throw new Error(`login ${username}: HTTP ${response.status()} ${await response.text()}`);
        const { user } = await response.json() as { user: { id: string } };
        return wrap(user.id, username, password, context);
      },
    });
    for (const context of contexts) await context.close().catch(() => {});
  },
});

export { expect };
