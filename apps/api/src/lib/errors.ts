/**
 * Application error types.
 *
 * Every error that can reach a Slack user or the dashboard is an `AppError`
 * with a stable machine code. Internal details (stack traces, provider bodies)
 * never leave the API — they are logged with a correlation ID instead (§23).
 */

export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'config'
  | 'ai_provider'
  | 'slack_api'
  | 'database'
  | 'storage'
  | 'internal';

export interface AppErrorOptions {
  statusCode?: number;
  kind?: ErrorKind;
  details?: unknown;
  cause?: unknown;
  /** Message safe to show in Slack or the dashboard. */
  userMessage?: string;
  retryable?: boolean;
  /** Set for provider errors so the fallback runner can decide. */
  providerRetryable?: boolean;
  code?: string;
}

const DEFAULT_STATUS: Record<ErrorKind, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  config: 503,
  ai_provider: 502,
  slack_api: 502,
  database: 500,
  storage: 500,
  internal: 500,
};

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly providerRetryable: boolean;
  readonly code: string;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.kind = options.kind ?? 'internal';
    this.statusCode = options.statusCode ?? DEFAULT_STATUS[this.kind];
    this.details = options.details;
    this.userMessage = options.userMessage ?? message;
    this.retryable = options.retryable ?? false;
    this.providerRetryable = options.providerRetryable ?? false;
    this.code = options.code ?? this.kind.toUpperCase();
  }

  toJSON(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(message, { kind: 'validation', details, code: 'VALIDATION_ERROR' });
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(message, { kind: 'unauthorized', code: 'UNAUTHORIZED' });
  }
  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(message, { kind: 'forbidden', code: 'FORBIDDEN' });
  }
  static notFound(what: string): AppError {
    return new AppError(`${what} not found`, { kind: 'not_found', code: 'NOT_FOUND' });
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError(message, { kind: 'conflict', details, code: 'CONFLICT' });
  }
  static configuration(message: string): AppError {
    return new AppError(message, { kind: 'config', code: 'CONFIGURATION_ERROR' });
  }
  static database(message: string, cause?: unknown): AppError {
    return new AppError(message, { kind: 'database', cause, code: 'DATABASE_ERROR' });
  }
  static storage(message: string, cause?: unknown): AppError {
    return new AppError(message, { kind: 'storage', cause, code: 'STORAGE_ERROR' });
  }
  static internal(message: string, cause?: unknown): AppError {
    return new AppError(message, { kind: 'internal', cause, code: 'INTERNAL_ERROR' });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) {
    return new AppError(value.message, { kind: 'internal', cause: value, code: 'INTERNAL_ERROR' });
  }
  return new AppError('Unexpected error', { kind: 'internal', details: value, code: 'INTERNAL_ERROR' });
}

/** Extracts a human-readable message from unknown provider/Slack errors. */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
