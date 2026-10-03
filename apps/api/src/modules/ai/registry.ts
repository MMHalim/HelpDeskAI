/**
 * Provider factory. Application code depends on `AIProvider` only, so adding a
 * provider means adding one file here and one case in the switch.
 */
import { AppError } from '../../lib/errors.js';
import { BaseAIProvider, type RequestContext } from './base.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import type { AIProvider, ProviderConfig } from './types.js';

export function createProvider(config: ProviderConfig, context: RequestContext): AIProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider(config, context);
    case 'openai':
      return new OpenAIProvider(config, context);
    default:
      throw AppError.configuration(`Unsupported AI provider: ${String(config.provider)}`);
  }
}

export { BaseAIProvider };
export type { RequestContext };
