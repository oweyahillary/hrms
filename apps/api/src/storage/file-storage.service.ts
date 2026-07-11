import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { sanitizeFilename } from './storage-path';

/**
 * Local-disk file storage under a configurable base directory (STORAGE_DIR).
 * Hosting-agnostic: point STORAGE_DIR at a mounted volume (Docker/VPS) or a
 * directory outside the web root (cPanel). The same interface can back an
 * S3 implementation later.
 */
@Injectable()
export class FileStorageService {
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = resolve(config.get<string>('STORAGE_DIR') ?? './storage');
  }

  /** Persist a buffer under relDir; returns the stored relative path (fwd slashes). */
  async save(relDir: string, originalName: string, data: Buffer): Promise<string> {
    const filename = sanitizeFilename(originalName);
    const rel = join(relDir, filename);
    const abs = this.resolveSafe(rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return rel.split(sep).join('/');
  }

  async read(relPath: string): Promise<Buffer> {
    return readFile(this.resolveSafe(relPath));
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.resolveSafe(relPath), { force: true });
  }

  /** Resolve within baseDir and refuse anything that escapes it (traversal guard). */
  private resolveSafe(relPath: string): string {
    const abs = resolve(this.baseDir, relPath);
    if (abs !== this.baseDir && !abs.startsWith(this.baseDir + sep)) {
      throw new Error('Resolved path escapes storage directory');
    }
    return abs;
  }
}
