/**
 * Fastify application factory (§15).
 *
 * Responsibilities:
 *  - capture the raw body so Slack request signatures can be verified,
 *  - install the cookie/CORS/rate-limit/multipart plugins,
 *  - normalise every error into a stable JSON envelope,
 *  - register the Slack webhook and the dashboard API.
 */
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './env.js';
import { AppError, errorMessage, isAppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { log } from './modules/logging/service.js';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: Math.max(env.MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024),
    disableRequestLogging: false,
  });

  // Capture the raw JSON body (Slack signs the exact bytes we receive).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    (request as FastifyRequest).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(AppError.validation('Request body is not valid JSON'));
    }
  });

  // Slack Interactivity posts form-encoded bodies (`payload=<json>`); keep the
  // raw bytes for signature verification and expose the form fields.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (request, body, done) => {
      (request as FastifyRequest).rawBody = body as string;
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch {
        done(AppError.validation('Request body is not valid form data'));
      }
    },
  );

  await app.register(cookie);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: env.rateLimit.max,
    timeWindow: env.rateLimit.windowMs,
    allowList: [],
  });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_ATTACHMENT_BYTES, files: 10 },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send(error.toJSON());
    }
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request',
          details: error.issues,
        },
      });
    }
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      log.error(
        {
          category: 'http',
          method: request.method,
          url: request.url,
          error: errorMessage(error),
        },
        'Unhandled request error',
      );
    }
    return reply.status(statusCode).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Something went wrong. Please try again.' : error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` } });
  });

  await registerRoutes(app);

  return app;
}
