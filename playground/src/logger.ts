// The playground's log: one JSON line per record in production, a readable line
// in development, in the same shape as the app's (server/src/lib/logger.ts) so
// both read alike side by side. Kept apart rather than shared, so this service
// builds without anything from server/.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
// a pass into the service is a credential: it never reaches a log line
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : value;
  return out;
}

function errorFields(err: unknown): { name: string; message: string; stack?: string } {
  return err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { name: 'NonError', message: String(err) };
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, err?: unknown, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

function createLogger(base: LogFields): Logger {
  const production = process.env.NODE_ENV === 'production';
  const requested = (process.env.LOG_LEVEL ?? '').toLowerCase();
  const level: LogLevel = requested in ORDER ? (requested as LogLevel) : production ? 'info' : 'debug';
  const json = (process.env.LOG_FORMAT ?? (production ? 'json' : 'pretty')) === 'json';

  function emit(lvl: LogLevel, msg: string, fields?: LogFields, err?: unknown): void {
    if (ORDER[lvl] < ORDER[level]) return;
    const { component, ...rest } = redact({ service: 'playground', ...base, ...fields });
    const time = new Date().toISOString();
    let line: string;
    if (json) {
      line = JSON.stringify({ time, level: lvl, msg, component, ...rest, ...(err !== undefined ? { err: errorFields(err) } : {}) });
    } else {
      delete rest.service;
      const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
      const errText = err !== undefined ? `\n${errorFields(err).stack ?? errorFields(err).message}` : '';
      line = `${time.slice(11, 23)} ${lvl.toUpperCase().padEnd(5)} [playground${component ? `:${String(component)}` : ''}] ${msg}${extra}${errText}`;
    }
    try { (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(`${line}\n`); } catch { /* never fatal */ }
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, err, fields) => emit('error', msg, fields, err),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export const logger = createLogger({});
