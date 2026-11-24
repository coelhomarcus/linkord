// Every environment variable the playground service reads. It runs as its own
// process (and, deployed, its own container from the same image as the app),
// so it shares no configuration with server/: only PLAYGROUND_SECRET has to
// match the app's.

/** Why the service cannot start, or null when it can. */
export function missingConfig(env: NodeJS.ProcessEnv): string | null {
  if (!(env.PLAYGROUND_DATABASE_URL ?? '').trim()) return 'PLAYGROUND_DATABASE_URL is not set';
  const secret = (env.PLAYGROUND_SECRET ?? '').trim();
  if (!secret) return 'PLAYGROUND_SECRET is not set';
  if (secret.length < 32) return 'PLAYGROUND_SECRET must be at least 32 characters (openssl rand -hex 32)';
  return null;
}

export interface PlaygroundConfig {
  databaseUrl: string;
  databaseSsl: boolean;
  secret: string;
  port: number;
  hostBind: string;
}

export function readConfig(env: NodeJS.ProcessEnv): PlaygroundConfig {
  return {
    databaseUrl: (env.PLAYGROUND_DATABASE_URL ?? '').trim(),
    databaseSsl: env.PLAYGROUND_DATABASE_SSL === '1',
    secret: (env.PLAYGROUND_SECRET ?? '').trim(),
    // the image sets it to 3000, the port its health check asks; a development run takes 3100,
    // next to the app's 3000
    port: Number(env.PLAYGROUND_PORT || 3100),
    hostBind: env.HOST_BIND || '0.0.0.0',
  };
}
