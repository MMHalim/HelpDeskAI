import { pino } from 'pino';
import { env } from '../env.js';
import { redactSecretValues } from './redact.js';

const transport =
  env.isProduction || env.isTest
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service,env,redactPaths',
        },
      };

export const logger = pino({
  level: env.LOG_LEVEL === 'silent' ? 'fatal' : env.LOG_LEVEL,
  base: { service: 'helpdesk-api' },
  transport,
  formatters: {
    level: (label) => ({ level: label }),
  },
  hooks: {
    logMethod(args, method) {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        args[args.length - 1] = redactSecretValues(last as Record<string, unknown>);
      } else {
        args.push({ redacted: redactSecretValues(args) });
      }
      return method.apply(this, args as never);
    },
  },
});

export type Logger = typeof logger;
