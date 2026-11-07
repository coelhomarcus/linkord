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

export interface Users {
  /** A fresh account in its own browser context (own cookies, own storage),
   * registered through the real sign-up route. */
  create(prefix?: string): Promise<User>;
  /** A context for an account that already exists, logged in through the real form. */
  login(username: string, password: string): Promise<User>;
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
    permissions: ['microphone', 'camera'],
  });
}

function wrap(id: string, username: string, password: string, context: BrowserContext): User {
  let first: Page | null = null;
  const page = async () => {
    if (!first) {
      first = await context.newPage();
      await first.goto('/app');
    }
    return first;
  };
  return {
    id, username, password, context, api: context.request, page,
    app: async () => new AppPage(await page()),
    newTab: async (path = '/app') => {
      const tab = await context.newPage();
      await tab.goto(path);
      return new AppPage(tab);
    },
  };
}

export const test = base.extend<{ users: Users }>({
  users: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use({
      async create(prefix = 'u') {
        const context = await newContext(browser);
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
