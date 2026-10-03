/**
 * File storage abstraction for Slack screenshots, knowledge-base images and
 * imported documents (§6, §7, §26).
 *
 * Two implementations:
 *  - LocalDiskStorage: development / single-container deployments.
 *  - SupabaseStorage:  production with Supabase (uses the Storage REST API,
 *    no extra SDK dependency).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { log } from '../logging/service.js';

export interface StoredFile {
  /** Storage key, e.g. `slack/2026/01/ab/cd123.png`. */
  key: string;
  url: string;
  size: number;
  sha256: string;
  mimetype: string;
}

export interface FileStorage {
  readonly name: string;
  put(key: string, data: Buffer, mimetype: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

export function extensionFor(mimetype: string, fallbackName?: string): string {
  const known = MIME_EXTENSIONS[mimetype.toLowerCase().split(';')[0]?.trim() ?? ''];
  if (known) return known;
  const ext = fallbackName ? path.extname(fallbackName).replace('.', '').toLowerCase() : '';
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : 'bin';
}

/** Content-addressed key: dedupes identical screenshots across sessions. */
export function buildKey(scope: string, data: Buffer, mimetype: string, filename?: string): string {
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${scope}/${year}/${month}/${hash.slice(0, 2)}/${hash}.${extensionFor(mimetype, filename)}`;
}

class LocalDiskStorage implements FileStorage {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root))) {
      throw AppError.validation('Invalid storage key');
    }
    return target;
  }

  async put(key: string, data: Buffer, mimetype: string): Promise<StoredFile> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return {
      key,
      url: this.publicUrl(key),
      size: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      mimetype,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch {
      throw AppError.notFound('Stored file');
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string): string {
    return `${env.storagePublicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}

class SupabaseStorage implements FileStorage {
  readonly name = 'supabase';
  private readonly base: string;
  private readonly bucket: string;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw AppError.configuration(
        'FILE_STORAGE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set',
      );
    }
    this.base = env.SUPABASE_URL.replace(/\/$/, '');
    this.bucket = env.SUPABASE_STORAGE_BUCKET;
  }

  private headers(): Record<string, string> {
    const key = env.SUPABASE_SERVICE_ROLE_KEY!;
    return {
      Authorization: `Bearer ${key}`,
      apikey: key,
    };
  }

  async put(key: string, data: Buffer, mimetype: string): Promise<StoredFile> {
    const response = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${key}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': mimetype, 'x-upsert': 'true' },
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      throw AppError.storage(`Supabase storage upload failed: ${response.status} ${await response.text()}`);
    }
    return {
      key,
      url: this.publicUrl(key),
      size: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      mimetype,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${key}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw AppError.notFound('Stored file');
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await fetch(`${this.base}/storage/v1/object/${this.bucket}/${key}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch((error: unknown) => {
      log.warn({ category: 'storage', error }, 'Failed to delete object from Supabase storage');
    });
  }

  publicUrl(key: string): string {
    // Private bucket: the dashboard loads images through the API proxy.
    return `${env.storagePublicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}

let instance: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (instance) return instance;
  if (env.FILE_STORAGE === 'supabase') {
    instance = new SupabaseStorage();
  } else {
    instance = new LocalDiskStorage(env.storageDir);
    void fs.mkdir(env.storageDir, { recursive: true }).catch(() => undefined);
  }
  return instance;
}

/** Test seam. */
export function __setStorage(storage: FileStorage | null): void {
  instance = storage;
}
