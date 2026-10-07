import type { FastifyInstance } from 'fastify';
import { articleInputSchema, articleQuerySchema, articleUpdateSchema, idParamSchema } from '@helpdesk/shared';
import { AppError } from '../lib/errors.js';
import { requireFeature } from '../plugins/auth.js';
import { parse } from './helpers.js';
import {
  attachImage,
  createArticle,
  deleteArticle,
  deleteArticleImage,
  getArticle,
  knowledgeBaseStats,
  listArticles,
  updateArticle,
} from '../modules/knowledge/articles.js';
import { listCategories } from '../modules/knowledge/search.js';
import {
  deleteDocument,
  getDocument,
  ingestDocument,
  listDocuments,
  reparseDocument,
} from '../modules/knowledge/ingest.js';
import { getStorage } from '../modules/storage/service.js';

function guessMimetype(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'] ?? '';
    if (!key) throw AppError.validation('Missing file key');
    try {
      const buffer = await getStorage().get(key);
      return reply.header('content-type', guessMimetype(key)).send(buffer);
    } catch {
      throw AppError.notFound('File');
    }
  });

  app.get('/api/articles', async (request) => {
    await requireFeature(request, 'articles');
    const query = parse(articleQuerySchema, request.query);
    return listArticles(query);
  });

  app.get('/api/articles/categories', async (request) => {
    await requireFeature(request, 'articles');
    return { categories: await listCategories() };
  });

  app.get('/api/articles/:id', async (request) => {
    await requireFeature(request, 'articles');
    const { id } = parse(idParamSchema, request.params);
    const article = await getArticle(id);
    if (!article) throw AppError.notFound('Article');
    return { article };
  });

  app.post('/api/articles', async (request, reply) => {
    const user = await requireFeature(request, 'articles.manage');
    const input = parse(articleInputSchema, request.body);
    const article = await createArticle(input, user);
    return reply.status(201).send({ article });
  });

  app.patch('/api/articles/:id', async (request) => {
    const user = await requireFeature(request, 'articles.manage');
    const { id } = parse(idParamSchema, request.params);
    const input = parse(articleUpdateSchema, request.body);
    return { article: await updateArticle(id, input, user) };
  });

  app.delete('/api/articles/:id', async (request) => {
    const user = await requireFeature(request, 'articles.manage');
    const { id } = parse(idParamSchema, request.params);
    await deleteArticle(id, user);
    return { ok: true };
  });

  app.post('/api/articles/:id/images', async (request, reply) => {
    await requireFeature(request, 'articles.manage');
    const { id } = parse(idParamSchema, request.params);
    await getArticle(id).then((article) => {
      if (!article) throw AppError.notFound('Article');
    });

    const file = await request.file();
    if (!file) throw AppError.validation('An image file is required');
    const buffer = await file.toBuffer();
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const readField = (name: string): string | undefined => {
      const field = fields[name];
      const value = field?.value;
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    const image = await attachImage(id, null, {
      data: buffer,
      filename: file.filename,
      mimetype: file.mimetype,
      label: readField('label'),
      description: readField('description'),
      stepId: readField('stepId') ?? null,
    });
    return reply.status(201).send({ imageId: image.id });
  });

  app.delete('/api/articles/images/:imageId', async (request) => {
    await requireFeature(request, 'articles.manage');
    const { imageId } = request.params as { imageId: string };
    await deleteArticleImage(imageId);
    return { ok: true };
  });

  app.get('/api/knowledge/stats', async (request) => {
    await requireFeature(request, 'articles');
    return knowledgeBaseStats();
  });

  app.get('/api/documents', async (request) => {
    await requireFeature(request, 'articles');
    return { documents: await listDocuments() };
  });

  app.get('/api/documents/:id', async (request) => {
    await requireFeature(request, 'articles');
    const { id } = parse(idParamSchema, request.params);
    const document = await getDocument(id);
    if (!document) throw AppError.notFound('Document');
    return { document };
  });

  app.post('/api/documents', async (request, reply) => {
    const user = await requireFeature(request, 'articles.manage');
    const file = await request.file();
    if (!file) throw AppError.validation('A document file is required');
    const buffer = await file.toBuffer();
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const readField = (name: string): string | undefined => {
      const value = fields[name]?.value;
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    const result = await ingestDocument({
      data: buffer,
      filename: file.filename,
      mimetype: file.mimetype,
      title: readField('title'),
      user,
      createArticles: readField('createArticles') !== 'false',
      describeImages: readField('describeImages') === 'true',
    });
    return reply.status(201).send(result);
  });

  app.post('/api/documents/:id/reparse', async (request) => {
    const user = await requireFeature(request, 'articles.manage');
    const { id } = parse(idParamSchema, request.params);
    return reparseDocument(id, user);
  });

  app.delete('/api/documents/:id', async (request) => {
    const user = await requireFeature(request, 'articles.manage');
    const { id } = parse(idParamSchema, request.params);
    await deleteDocument(id, user);
    return { ok: true };
  });
}
