import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export const SCHEMA_CACHE_JSON_VERSION = '1.0.0';

export interface SchemaCacheFilePayload {
  version: string;
  dataSourceId: string;
  cachedAt: string;
  tables: any[];
}

export function getSchemaCacheDir(): string {
  return path.join(app.getPath('userData'), 'schema-cache');
}

export function ensureSchemaCacheDir(): void {
  const dir = getSchemaCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('[schema-cache] Created directory:', dir);
  }
}

function cacheFilePath(dataSourceId: string): string {
  const safeId = dataSourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSchemaCacheDir(), `${safeId}.json`);
}

export function readSchemaCacheFromFile(dataSourceId: string): SchemaCacheFilePayload | undefined {
  try {
    const fp = cacheFilePath(dataSourceId);
    if (!fs.existsSync(fp)) return undefined;
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw) as SchemaCacheFilePayload;
    if (!parsed || !Array.isArray(parsed.tables)) return undefined;
    return parsed;
  } catch (e) {
    console.error('[schema-cache] read failed:', dataSourceId, e);
    return undefined;
  }
}

export function writeSchemaCacheToFile(dataSourceId: string, tables: any[]): void {
  ensureSchemaCacheDir();
  const fp = cacheFilePath(dataSourceId);
  const payload: SchemaCacheFilePayload = {
    version: SCHEMA_CACHE_JSON_VERSION,
    dataSourceId,
    cachedAt: new Date().toISOString(),
    tables,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), 'utf-8');
  console.log('[schema-cache] Wrote', tables.length, 'tables for', dataSourceId);
}

export function deleteSchemaCacheFile(dataSourceId: string): void {
  try {
    const fp = cacheFilePath(dataSourceId);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      console.log('[schema-cache] Deleted file for', dataSourceId);
    }
  } catch (e) {
    console.error('[schema-cache] delete file failed:', dataSourceId, e);
  }
}
