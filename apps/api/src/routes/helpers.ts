/** Small request-parsing helpers shared by the route modules. */
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') ?? '';
    throw AppError.validation(path ? `${path}: ${first?.message}` : (first?.message ?? 'Invalid request'), result.error.issues);
  }
  return result.data;
}
