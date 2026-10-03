/**
 * Slack attachment handling (§7).
 *
 * Downloads the file with the bot token, stores a local copy so the image can
 * be re-analysed later (session view, knowledge-base matching) and returns the
 * persisted `slack_files` row.
 */
import { and, eq } from 'drizzle-orm';
import type { ScreenshotAnalysis } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { slackFiles, type SlackFileRow } from '../../db/schema.js';
import { AppError, errorMessage } from '../../lib/errors.js';
import { log } from '../logging/service.js';
import { getStorage, buildKey } from '../storage/service.js';
import { getSlackSecrets } from '../settings/service.js';
import type { SlackFileObject } from './types.js';

const IMAGE_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

const IMAGE_FILETYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic']);

export function isImageFile(file: SlackFileObject): boolean {
  // Trust an explicit image mimetype or filetype first: Slack's `mode` is not
  // always `image` (e.g. hosted/pasted screenshots) even for real images.
  const mimetype = file.mimetype?.toLowerCase() ?? '';
  if (IMAGE_MIMETYPES.has(mimetype)) return true;
  const filetype = (file.filetype ?? '').toLowerCase();
  if (IMAGE_FILETYPES.has(filetype)) return true;
  if (mimetype.startsWith('image/')) return true;
  // Fall back to the coarse `mode` only when nothing else identifies the file.
  if (file.mode === 'image') return true;
  return false;
}

/** Downloads a Slack file. Respects the configured maximum attachment size. */
export async function downloadSlackFile(
  urlPrivate: string,
  maxBytes: number,
): Promise<{ data: Buffer; contentType: string }> {
  const { botToken } = await getSlackSecrets();
  if (!botToken) throw AppError.configuration('No Slack bot token configured');

  const response = await fetch(urlPrivate, {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new AppError(`Failed to download Slack attachment (HTTP ${response.status})`, {
      kind: 'slack_api',
      code: 'SLACK_FILE_DOWNLOAD_FAILED',
    });
  }

  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError(`Attachment is ${declared} bytes, larger than the ${maxBytes} byte limit`, {
      kind: 'validation',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new AppError(`Attachment is ${arrayBuffer.byteLength} bytes, larger than the ${maxBytes} byte limit`, {
      kind: 'validation',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  }

  return {
    data: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export interface PersistSlackFileInput {
  file: SlackFileObject;
  channelId: string;
  messageTs: string;
  threadTs?: string | null;
  userId?: string | null;
  maxBytes: number;
  correlationId?: string;
}

/**
 * Ensures a Slack file exists locally and in the database.
 * Re-analyzing the same file id is avoided: the row is reused.
 */
export async function persistSlackFile(input: PersistSlackFileInput): Promise<SlackFileRow> {
  const { file, channelId, messageTs, threadTs, userId, maxBytes, correlationId } = input;

  const existing = await db
    .select()
    .from(slackFiles)
    .where(eq(slackFiles.slackFileId, file.id))
    .limit(1);
  if (existing[0]?.storagePath) return existing[0];

  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new AppError('Slack file has no downloadable URL', { kind: 'slack_api' });
  }
  if (file.is_external && file.external_url) {
    // Externally shared files (OneDrive/Google Drive links) are not retrievable
    // with the bot token; record the row so the UI can show the link.
    const [row] = await db
      .insert(slackFiles)
      .values({
        slackFileId: file.id,
        messageTs,
        channelId,
        threadTs: threadTs ?? null,
        userId: userId ?? null,
        name: file.name ?? file.title ?? 'external-file',
        title: file.title ?? null,
        mimetype: file.mimetype ?? null,
        size: file.size ?? 0,
        width: file.width ?? null,
        height: file.height ?? null,
        permalink: file.permalink ?? null,
        urlPrivate: file.external_url,
      })
      .onConflictDoUpdate({
        target: slackFiles.slackFileId,
        set: { urlPrivate: file.external_url },
      })
      .returning();
    return row!;
  }

  const { data, contentType } = await downloadSlackFile(url, maxBytes);
  const mimetype = file.mimetype ?? contentType ?? 'application/octet-stream';
  const storage = getStorage();
  const key = buildKey('slack', data, mimetype, file.name);
  const stored = await storage.put(key, data, mimetype);

  const [row] = await db
    .insert(slackFiles)
    .values({
      slackFileId: file.id,
      messageTs,
      channelId,
      threadTs: threadTs ?? null,
      userId: userId ?? null,
      name: file.name ?? file.title ?? 'attachment',
      title: file.title ?? null,
      mimetype,
      size: data.length,
      width: file.width ?? null,
      height: file.height ?? null,
      urlPrivate: url,
      permalink: file.permalink ?? null,
      storagePath: stored.key,
      sha256: stored.sha256,
    })
    .onConflictDoUpdate({
      target: slackFiles.slackFileId,
      set: {
        storagePath: stored.key,
        sha256: stored.sha256,
        size: data.length,
        mimetype,
      },
    })
    .returning();

  log.info(
    {
      category: 'slack',
      correlationId,
      slackFileId: file.id,
      bytes: data.length,
      mimetype,
    },
    'Stored Slack attachment',
  );

  return row!;
}

export async function getSlackFile(id: string): Promise<SlackFileRow | null> {
  const rows = await db.select().from(slackFiles).where(eq(slackFiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listSlackFilesForMessage(
  channelId: string,
  messageTs: string,
): Promise<SlackFileRow[]> {
  return db
    .select()
    .from(slackFiles)
    .where(and(eq(slackFiles.channelId, channelId), eq(slackFiles.messageTs, messageTs)));
}

/** Reads the stored bytes of a Slack file (used to send images to the model). */
export async function readSlackFileBytes(row: SlackFileRow): Promise<Buffer | null> {
  if (!row.storagePath) return null;
  try {
    return await getStorage().get(row.storagePath);
  } catch (error) {
    log.warn(
      { category: 'slack', error: errorMessage(error), slackFileId: row.slackFileId },
      'Could not read stored Slack attachment',
    );
    return null;
  }
}

export async function saveAnalysis(
  id: string,
  analysis: ScreenshotAnalysis,
): Promise<void> {
  await db
    .update(slackFiles)
    .set({ analysis: analysis as never, analyzedAt: new Date() })
    .where(eq(slackFiles.id, id));
}

export function fileToDto(row: SlackFileRow) {
  const storage = getStorage();
  return {
    id: row.id,
    fileId: row.slackFileId,
    name: row.name,
    mimetype: row.mimetype,
    size: row.size,
    width: row.width,
    height: row.height,
    url: row.storagePath ? storage.publicUrl(row.storagePath) : (row.permalink ?? row.urlPrivate ?? ''),
    analysis: (row.analysis as ScreenshotAnalysis | null) ?? null,
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
  };
}
