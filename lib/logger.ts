/**
 * Lightweight structured logger for server-side audit work.
 * Levels: debug < info < warn < error. Controlled by LOG_LEVEL (default: info).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      error: err.message,
      name: err.name,
      stack: err.stack?.split('\n').slice(0, 6).join('\n'),
    };
  }
  return { error: String(err) };
}

function write(level: LogLevel, scope: string, message: string, ctx: LogContext): void {
  if (RANK[level] < RANK[envLevel()]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...ctx,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export type Logger = {
  child(ctx: LogContext): Logger;
  debug(message: string, ctx?: LogContext): void;
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext | unknown): void;
  time(label: string): () => number;
};

export function createLogger(scope: string, base: LogContext = {}): Logger {
  const emit = (level: LogLevel, message: string, ctx: LogContext = {}) => {
    write(level, scope, message, { ...base, ...ctx });
  };

  return {
    child(ctx: LogContext) {
      return createLogger(scope, { ...base, ...ctx });
    },
    debug(message, ctx = {}) {
      emit('debug', message, ctx);
    },
    info(message, ctx = {}) {
      emit('info', message, ctx);
    },
    warn(message, ctx = {}) {
      emit('warn', message, ctx);
    },
    error(message, ctx = {}) {
      if (ctx instanceof Error || typeof ctx !== 'object' || ctx === null || Array.isArray(ctx)) {
        emit('error', message, serializeError(ctx));
        return;
      }
      const maybeErr = (ctx as LogContext).err ?? (ctx as LogContext).error;
      if (maybeErr instanceof Error) {
        const { err: _e, error: _er, ...rest } = ctx as LogContext;
        emit('error', message, { ...rest, ...serializeError(maybeErr) });
        return;
      }
      emit('error', message, ctx as LogContext);
    },
    time(label: string) {
      const started = Date.now();
      return () => {
        const ms = Date.now() - started;
        emit('debug', label, { ms });
        return ms;
      };
    },
  };
}

/** Default app logger. Prefer createLogger('scope') for step-specific context. */
export const logger = createLogger('app');
