import { config } from '../../config/env.js';
import { ConnectionFetchError, fetchSafeConnectionJson, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TOKEN_MARGIN_MS = 60_000;

export function createAppToken({ clientId, clientSecret, request = fetchSafeConnectionJson, now = Date.now }: {
  clientId: string;
  clientSecret: string;
  request?: RequestJson;
  now?: () => number;
}) {
  const configured = Boolean(clientId && clientSecret);
  let token: { value: string; expiresAt: number } | null = null;
  let renewal: Promise<string> | null = null;

  async function renew(): Promise<string> {
    const query = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
    const response = record(await request(`${TOKEN_URL}?${query}`, { method: 'POST' }).catch((error) => {
      if (error instanceof ConnectionFetchError && error.code === 'unauthorized') throw new ConnectionFetchError('unavailable');
      throw error;
    }));
    const value = textValue(response.access_token);
    const seconds = numberValue(response.expires_in);
    if (!value || !seconds) throw new ConnectionFetchError('invalid_response');
    token = { value, expiresAt: now() + seconds * 1000 - TOKEN_MARGIN_MS };
    return value;
  }

  function accessToken() {
    if (token && token.expiresAt > now()) return Promise.resolve(token.value);
    renewal ??= renew().finally(() => { renewal = null; });
    return renewal;
  }

  return {
    configured,
    async authorize<T>(run: (headers: Record<string, string>) => Promise<T>): Promise<T> {
      if (!configured) throw new ConnectionFetchError('unavailable');
      const headers = (value: string) => ({ 'Client-ID': clientId, Authorization: `Bearer ${value}`, Accept: 'application/json' });
      const used = await accessToken();
      try {
        return await run(headers(used));
      } catch (error) {
        if (!(error instanceof ConnectionFetchError) || error.code !== 'unauthorized') throw error;
        if (token?.value === used) token = null;
        return run(headers(await accessToken()));
      }
    },
  };
}

export const twitchAppToken = createAppToken({ clientId: config.IGDB_CLIENT_ID, clientSecret: config.IGDB_CLIENT_SECRET });
