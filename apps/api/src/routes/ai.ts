import type { FastifyInstance } from 'fastify';
import { aiInstructionsInputSchema, aiProviderUpdateSchema } from '@helpdesk/shared';
import { requireAdmin, requireFeature } from '../plugins/auth.js';
import { parse } from './helpers.js';
import {
  deleteProviderKey,
  getInstructionsDto,
  getProviderHealth,
  listProviderDtos,
  updateInstructions,
  updateProviderConfigs,
} from '../modules/ai/config-service.js';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ai/providers', async (request) => {
    await requireFeature(request, 'ai');
    return { providers: await listProviderDtos() };
  });

  app.get('/api/ai/providers/health', async (request) => {
    await requireFeature(request, 'ai');
    return { providers: await getProviderHealth() };
  });

  app.put('/api/ai/providers', async (request) => {
    const user = await requireAdmin(request);
    const input = parse(aiProviderUpdateSchema, request.body);
    return { providers: await updateProviderConfigs(input, user) };
  });

  app.delete('/api/ai/providers/:provider', async (request) => {
    await requireAdmin(request);
    const { provider } = request.params as { provider: string };
    await deleteProviderKey(provider as never);
    return { ok: true };
  });

  app.get('/api/ai/instructions', async (request) => {
    await requireFeature(request, 'ai');
    return { instructions: await getInstructionsDto() };
  });

  app.put('/api/ai/instructions', async (request) => {
    const user = await requireAdmin(request);
    const input = parse(aiInstructionsInputSchema, request.body);
    const instructions = await updateInstructions(input.content, input.changeNote, input.activate ?? true, user);
    return { instructions };
  });
}
