import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureSchemaCacheDir,
  readSchemaCacheFromFile,
  writeSchemaCacheToFile,
  deleteSchemaCacheFile,
  getSchemaCacheDir,
} from './schemaCacheFiles';
import { mergeSchemaIncremental, schemaTableKey } from './schemaMerge';
import { initReportTables, invalidateTableRelationships } from './reportStorage';

const ENCRYPTION_KEY = 'zoe-devops-encryption-key-v1';
const OLD_ENCRYPTION_KEY = 'zoehis-helper-encryption-key-v1';

export interface DataSourceRecord {
  id: string;
  projectId: string;
  name: string;
  type: 'oracle' | 'dameng';
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  schema?: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfigRecord {
  id: string;
  projectId: string;
  apiBaseUrl?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
  apiLogPath?: string;
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  redisDb?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeRepositoryRecord {
  id: string;
  projectId: string;
  name: string;
  repositoryUrl: string;
  servicePatterns: string; // 逗号分隔的匹配模式，如 "pres-service,prescription"
  gitLabToken?: string;
  defaultBranch?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalConfigRecord {
  id: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  gitLabBaseUrl?: string;
  gitLabToken?: string;
  createdAt: string;
  updatedAt: string;
}

let db: SqlJsDatabase | null = null;
let dbPath: string = '';

export function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
      console.log('Database saved to:', dbPath);
    } catch (e) {
      console.error('Failed to save database:', e);
    }
  }
}

/** 将旧版 SQLite schema_cache 一次性迁出到 userData/schema-cache/{id}.json */
function migrateSchemaCacheFromSqliteToFiles(): void {
  if (!db) return;
  try {
    ensureSchemaCacheDir();
    const database = db;
    const stmt = database.prepare('SELECT dataSourceId, schemaData FROM schema_cache');
    const byId = new Map<string, any[]>();
    while (stmt.step()) {
      const row = stmt.get() as unknown[];
      const dsId = row[0] as string;
      let tables: any[];
      try {
        tables = JSON.parse(row[1] as string);
      } catch {
        continue;
      }
      if (!Array.isArray(tables)) continue;
      const prev = byId.get(dsId) || [];
      byId.set(dsId, mergeSchemaIncremental(prev, tables));
    }
    stmt.free();

    if (byId.size === 0) {
      return;
    }

    for (const [dsId, tables] of byId) {
      writeSchemaCacheToFile(dsId, tables);
    }
    database.run('DELETE FROM schema_cache');
    console.log('[schema-cache] Migrated', byId.size, 'data source(s) from SQLite to JSON files');
  } catch (e) {
    console.error('[schema-cache] SQLite migration failed:', e);
  }
}

/** 将用旧密钥加密的密码字段迁移为新密钥加密 */
function migrateEncryptionKeys(): void {
  if (!db) return;
  try {
    // 迁移 data_sources.password
    const dsRows = db.exec('SELECT id, password FROM data_sources WHERE password IS NOT NULL AND password != \'\'');
    if (dsRows.length > 0) {
      for (const row of dsRows[0].values) {
        const [id, encPwd] = row as [string, string];
        try {
          const plain = CryptoJS.AES.decrypt(encPwd, OLD_ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
          if (plain) {
            const newEnc = CryptoJS.AES.encrypt(plain, ENCRYPTION_KEY).toString();
            db.run('UPDATE data_sources SET password = ? WHERE id = ?', [newEnc, id]);
          }
        } catch {
          /* 解密失败，跳过（可能已是新密钥加密） */
        }
      }
    }

    // 迁移 global_config.deepseekApiKey
    const gcRows = db.exec('SELECT id, deepseekApiKey FROM global_config WHERE deepseekApiKey IS NOT NULL AND deepseekApiKey != \'\'');
    if (gcRows.length > 0) {
      for (const row of gcRows[0].values) {
        const [id, encKey] = row as [string, string];
        try {
          const plain = CryptoJS.AES.decrypt(encKey, OLD_ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
          if (plain) {
            const newEnc = CryptoJS.AES.encrypt(plain, ENCRYPTION_KEY).toString();
            db.run('UPDATE global_config SET deepseekApiKey = ? WHERE id = ?', [newEnc, id]);
          }
        } catch {
          /* 跳过 */
        }
      }
    }

    // 迁移 code_repositories.gitLabToken
    const repoRows = db.exec('SELECT id, gitLabToken FROM code_repositories WHERE gitLabToken IS NOT NULL AND gitLabToken != \'\'');
    if (repoRows.length > 0) {
      for (const row of repoRows[0].values) {
        const [id, encTok] = row as [string, string];
        try {
          const plain = CryptoJS.AES.decrypt(encTok, OLD_ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
          if (plain) {
            const newEnc = CryptoJS.AES.encrypt(plain, ENCRYPTION_KEY).toString();
            db.run('UPDATE code_repositories SET gitLabToken = ? WHERE id = ?', [newEnc, id]);
          }
        } catch {
          /* 跳过 */
        }
      }
    }

    saveDatabase();
    console.log('Encryption key migration completed');
  } catch (e) {
    console.error('Encryption key migration failed:', e);
  }
}

export async function initDatabase() {
  console.log('Initializing database...');

  const userDataPath = app.getPath('userData');
  const oldDbPath = path.join(userDataPath, 'zoehis-helper.db');
  dbPath = path.join(userDataPath, 'zoe-devops.db');
  console.log('Database path:', dbPath);

  // 迁移旧数据库文件
  let needsEncryptionMigration = false;
  if (!fs.existsSync(dbPath) && fs.existsSync(oldDbPath)) {
    fs.renameSync(oldDbPath, dbPath);
    console.log('Migrated database file from zoehis-helper.db to zoe-devops.db');
    needsEncryptionMigration = true;
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    try {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log('Loaded existing database');
      
      // 检查 data_sources 表是否有 projectId 列
      try {
        const result = db.exec("PRAGMA table_info(data_sources)");
        if (result.length > 0) {
          const columns = result[0].values.map(col => col[1] as string);
          if (!columns.includes('projectId')) {
            console.log('Migrating data_sources table to new schema...');
            // 保存 schema_cache 数据
            let schemaCacheData: any[] = [];
            try {
              const cacheResult = db.exec("SELECT * FROM schema_cache");
              if (cacheResult.length > 0) {
                schemaCacheData = cacheResult[0].values;
              }
              console.log('Saved', schemaCacheData.length, 'schema cache records to preserve');
            } catch (e) {
              console.log('No schema_cache table or data to preserve');
            }
            
            // 删除旧表
            db.run("DROP TABLE IF EXISTS data_sources");
            
            // 创建新表
            db.run(`
              CREATE TABLE data_sources (
                id TEXT PRIMARY KEY,
                projectId TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                sid TEXT,
                serviceName TEXT,
                schema TEXT,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
              )
            `);
            
            // 恢复 schema_cache 数据
            if (schemaCacheData.length > 0) {
              console.log('Restoring', schemaCacheData.length, 'schema cache records...');
              // 不指定列名，因为旧数据可能有不同的列结构
              for (const row of schemaCacheData) {
                try {
                  const stmt = db.prepare('INSERT INTO schema_cache (id, dataSourceId, schemaData, filterPattern, cachedAt) VALUES (?, ?, ?, ?, ?)');
                  // 只取前5列，忽略可能存在的 version 列
                  stmt.run([row[0], row[1], row[2], row[3], row[4]]);
                  stmt.free();
                } catch (e) {
                  console.log('Error restoring cache record, skipping:', e);
                }
              }
            }
            
            // 保存数据库
            saveDatabase();
            console.log('Migration completed');
          }
        }
      } catch (checkError) {
        console.log('Error checking/migrating table structure:', checkError);
      }
    } catch (e) {
      console.log('Failed to load existing database, creating new one');
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  if (!db) {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      sid TEXT,
      serviceName TEXT,
      schema TEXT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      sql TEXT NOT NULL,
      executedAt TEXT NOT NULL,
      executionTime INTEGER NOT NULL,
      rowCount INTEGER NOT NULL,
      dataSourceId TEXT NOT NULL,
      dataSourceName TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_cache (
      id TEXT PRIMARY KEY,
      dataSourceId TEXT NOT NULL,
      schemaData TEXT NOT NULL,
      filterPattern TEXT,
      cachedAt TEXT NOT NULL,
      FOREIGN KEY (dataSourceId) REFERENCES data_sources(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_schema_cache_dataSourceId ON schema_cache(dataSourceId)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_schema_cache_dataSourceId_filter ON schema_cache(dataSourceId, filterPattern)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      isActive INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);



  db.run(`
    CREATE TABLE IF NOT EXISTS project_configs (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL UNIQUE,
      apiBaseUrl TEXT,
      apiTokenPath TEXT,
      apiVersionPath TEXT,
      apiLogPath TEXT,
      redisHost TEXT,
      redisPort INTEGER,
      redisPassword TEXT,
      redisDb INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS code_repositories (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      repositoryUrl TEXT NOT NULL,
      servicePatterns TEXT NOT NULL,
      gitLabToken TEXT,
      defaultBranch TEXT DEFAULT 'main',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS global_config (
      id TEXT PRIMARY KEY,
      deepseekApiKey TEXT,
      deepseekBaseUrl TEXT,
      deepseekModel TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  // 迁移 global_config 表：添加 GitLab 字段（若不存在）
  try { db.run('ALTER TABLE global_config ADD COLUMN gitLabBaseUrl TEXT'); } catch { /* 已存在则跳过 */ }
  try { db.run('ALTER TABLE global_config ADD COLUMN gitLabToken TEXT'); } catch { /* 已存在则跳过 */ }

  // 添加默认的代码仓库配置（用于新用户快速上手）
  // 检查是否已有数据，避免重复添加
  try {
    const checkResult = db.exec('SELECT COUNT(*) as cnt FROM code_repositories');
    if (checkResult.length > 0 && checkResult[0].values.length > 0 && checkResult[0].values[0][0] === 0) {
      console.log('Initializing default code repositories...');
      // 这里会在前端首次使用时添加，不在数据库初始化时添加
    }
  } catch (e) {
    // 忽略检查错误
  }

  if (needsEncryptionMigration) {
    migrateEncryptionKeys();
  }

  ensureSchemaCacheDir();
  migrateSchemaCacheFromSqliteToFiles();

  initReportTables();

  saveDatabase();
  console.log('Database initialized successfully');
}

export function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('Database closed');
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function encryptPassword(password: string): string {
  return CryptoJS.AES.encrypt(password, ENCRYPTION_KEY).toString();
}

export function decryptPassword(encrypted: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

export function getAllDataSources(): DataSourceRecord[] {
  const database = getDb();
  const results = database.exec('SELECT * FROM data_sources ORDER BY name');
  if (results.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as string,
    projectId: row[1] as string,
    name: row[2] as string,
    type: row[3] as 'oracle' | 'dameng',
    host: row[4] as string,
    port: row[5] as number,
    sid: row[6] as string | undefined,
    serviceName: row[7] as string | undefined,
    schema: row[8] as string | undefined,
    username: row[9] as string,
    password: decryptPassword(row[10] as string),
    createdAt: row[11] as string,
    updatedAt: row[12] as string,
  }));
}

export function getDataSourceById(id: string): DataSourceRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM data_sources WHERE id = ?');
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return {
      id: row[0] as string,
      projectId: row[1] as string,
      name: row[2] as string,
      type: row[3] as 'oracle' | 'dameng',
      host: row[4] as string,
      port: row[5] as number,
      sid: row[6] as string | undefined,
      serviceName: row[7] as string | undefined,
      schema: row[8] as string | undefined,
      username: row[9] as string,
      password: decryptPassword(row[10] as string),
      createdAt: row[11] as string,
      updatedAt: row[12] as string,
    };
  }

  stmt.free();
  return undefined;
}

export function createDataSource(ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & { password: string }): DataSourceRecord {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const encryptedPassword = encryptPassword(ds.password);

  database.run(
    `INSERT INTO data_sources (id, projectId, name, type, host, port, sid, serviceName, schema, username, password, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ds.projectId, ds.name, ds.type, ds.host, ds.port, ds.sid || null, ds.serviceName || null, ds.schema || null, ds.username, encryptedPassword, now, now]
  );

  saveDatabase();

  return {
    ...ds,
    id,
    password: ds.password,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDataSource(id: string, ds: Partial<DataSourceRecord>): DataSourceRecord | undefined {
  const database = getDb();
  const existing = getDataSourceById(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated = { ...existing, ...ds, updatedAt: now };

  if (ds.password) {
    updated.password = ds.password;
  }

  const encryptedPassword = encryptPassword(updated.password);

  database.run(
    `UPDATE data_sources SET projectId = ?, name = ?, type = ?, host = ?, port = ?, sid = ?, serviceName = ?, schema = ?, username = ?, password = ?, updatedAt = ? WHERE id = ?`,
    [updated.projectId, updated.name, updated.type, updated.host, updated.port, updated.sid || null, updated.serviceName || null, updated.schema || null, updated.username, encryptedPassword, now, id]
  );

  saveDatabase();
  return updated;
}

export function deleteDataSource(id: string) {
  deleteSchemaCacheFile(id);
  const database = getDb();
  database.run('DELETE FROM data_sources WHERE id = ?', [id]);
  saveDatabase();
}

export function getDataSourceByProjectId(projectId: string): DataSourceRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM data_sources WHERE projectId = ?');
  stmt.bind([projectId]);

  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return {
      id: row[0] as string,
      projectId: row[1] as string,
      name: row[2] as string,
      type: row[3] as 'oracle' | 'dameng',
      host: row[4] as string,
      port: row[5] as number,
      sid: row[6] as string | undefined,
      serviceName: row[7] as string | undefined,
      schema: row[8] as string | undefined,
      username: row[9] as string,
      password: decryptPassword(row[10] as string),
      createdAt: row[11] as string,
      updatedAt: row[12] as string,
    };
  }

  stmt.free();
  return undefined;
}

export function getActiveDataSource(): DataSourceRecord | undefined {
  const project = getActiveProject();
  if (!project) return undefined;
  return getDataSourceByProjectId(project.id);
}

export function getQueryHistory(limit: number = 100): any[] {
  const database = getDb();
  const results = database.exec(`SELECT * FROM query_history ORDER BY executedAt DESC LIMIT ${limit}`);
  if (results.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as string,
    sql: row[1] as string,
    executedAt: row[2] as string,
    executionTime: row[3] as number,
    rowCount: row[4] as number,
    dataSourceId: row[5] as string,
    dataSourceName: row[6] as string,
  }));
}

export function addQueryHistory(history: Omit<any, 'id'>) {
  const database = getDb();
  const id = uuidv4();

  database.run(
    `INSERT INTO query_history (id, sql, executedAt, executionTime, rowCount, dataSourceId, dataSourceName) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, history.sql, history.executedAt, history.executionTime, history.rowCount, history.dataSourceId, history.dataSourceName]
  );

  saveDatabase();
}

export function clearQueryHistory() {
  const database = getDb();
  database.run('DELETE FROM query_history');
  saveDatabase();
}

export function getSchemaCache(dataSourceId: string, filterPattern?: string, matchAnyFilter: boolean = false): any | undefined {
  ensureSchemaCacheDir();
  void filterPattern;
  void matchAnyFilter;

  let filePayload = readSchemaCacheFromFile(dataSourceId);
  if (!filePayload) {
    migrateSchemaCacheFromSqliteToFiles();
    filePayload = readSchemaCacheFromFile(dataSourceId);
  }
  if (!filePayload) return undefined;

  return {
    id: dataSourceId,
    dataSourceId,
    schemaData: filePayload.tables,
    filterPattern: null,
    cachedAt: filePayload.cachedAt,
  };
}

export function setSchemaCache(dataSourceId: string, schemaData: any[], filterPattern?: string) {
  void filterPattern;
  console.log('[schema-cache] setSchemaCache', dataSourceId, 'table count:', schemaData.length);
  try {
    invalidateTableRelationships(dataSourceId);
  } catch (e) {
    console.warn('[report] invalidate relationships on schema refresh:', e);
  }
  writeSchemaCacheToFile(dataSourceId, schemaData);
  const database = getDb();
  try {
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
  } catch (e) {
    console.warn('[schema-cache] cleanup SQLite rows:', e);
  }
  saveDatabase();
  return { id: dataSourceId, cachedAt: new Date().toISOString() };
}

export function clearSchemaCache(dataSourceId?: string) {
  if (dataSourceId) {
    deleteSchemaCacheFile(dataSourceId);
    const database = getDb();
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
  } else {
    try {
      const dir = getSchemaCacheDir();
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.json')) {
            fs.unlinkSync(path.join(dir, name));
          }
        }
      }
    } catch (e) {
      console.error('[schema-cache] clear all files:', e);
    }
    const database = getDb();
    database.run('DELETE FROM schema_cache');
  }
  saveDatabase();
}

export function cleanOldSchemaCache(keepDays: number = 30) {
  const cutoff = Date.now() - keepDays * 86400000;
  try {
    ensureSchemaCacheDir();
    const dir = getSchemaCacheDir();
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const fp = path.join(dir, name);
        const st = fs.statSync(fp);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
        }
      }
    }
  } catch (e) {
    console.error('[schema-cache] cleanOldSchemaCache files:', e);
  }
  const database = getDb();
  database.run('DELETE FROM schema_cache WHERE cachedAt < ?', [new Date(cutoff).toISOString()]);
  saveDatabase();
}

export function removeTableFromSchemaCache(dataSourceId: string, tableName: string) {
  const payload = readSchemaCacheFromFile(dataSourceId);
  if (!payload) return;

  const schemaArray = Array.isArray(payload.tables) ? payload.tables : [];
  const filteredSchema = schemaArray.filter(
    (table: any) => schemaTableKey(table.tableName) !== schemaTableKey(tableName)
  );
  if (filteredSchema.length === schemaArray.length) return;

  if (filteredSchema.length > 0) {
    writeSchemaCacheToFile(dataSourceId, filteredSchema);
  } else {
    deleteSchemaCacheFile(dataSourceId);
  }
  try {
    getDb().run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    saveDatabase();
  } catch {
    /* ignore */
  }
}

export function removeTablesFromSchemaCache(dataSourceId: string, tableNames: string[]) {
  const payload = readSchemaCacheFromFile(dataSourceId);
  if (!payload) return;

  const keySet = new Set(tableNames.map((n) => schemaTableKey(n)));
  const schemaArray = Array.isArray(payload.tables) ? payload.tables : [];
  const filteredSchema = schemaArray.filter((table: any) => !keySet.has(schemaTableKey(table.tableName)));
  if (filteredSchema.length === schemaArray.length) return;

  if (filteredSchema.length > 0) {
    writeSchemaCacheToFile(dataSourceId, filteredSchema);
  } else {
    deleteSchemaCacheFile(dataSourceId);
  }
  try {
    getDb().run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    saveDatabase();
  } catch {
    /* ignore */
  }
}

export function getAllProjects(): ProjectRecord[] {
  const database = getDb();
  const results = database.exec('SELECT * FROM projects ORDER BY createdAt DESC');
  if (results.length === 0 || results[0].values.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string | undefined,
    isActive: row[3] as number,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  }));
}

export function getProjectById(id: string): ProjectRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM projects WHERE id = ?');
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return {
      id: row[0] as string,
      name: row[1] as string,
      description: row[2] as string | undefined,
      isActive: row[3] as number,
      createdAt: row[4] as string,
      updatedAt: row[5] as string,
    };
  }

  stmt.free();
  return undefined;
}

export function createProject(project: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): ProjectRecord {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  database.run(
    `INSERT INTO projects (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, project.name, project.description || null, project.isActive || 0, now, now]
  );

  saveDatabase();

  return {
    ...project,
    id,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProject(id: string, updates: Partial<ProjectRecord>): ProjectRecord | undefined {
  const database = getDb();
  const existing = getProjectById(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated = { ...existing, ...updates, updatedAt: now };

  database.run(
    `UPDATE projects SET name = ?, description = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    [updated.name, updated.description || null, updated.isActive, now, id]
  );

  saveDatabase();
  return updated;
}

export function deleteProject(id: string) {
  const database = getDb();
  database.run('DELETE FROM projects WHERE id = ?', [id]);
  saveDatabase();
}

export function setActiveProject(id: string) {
  const database = getDb();
  database.run('UPDATE projects SET isActive = 0');
  database.run('UPDATE projects SET isActive = 1 WHERE id = ?', [id]);
  saveDatabase();
}

export function getActiveProject(): ProjectRecord | undefined {
  const database = getDb();
  const results = database.exec('SELECT * FROM projects WHERE isActive = 1');
  if (results.length === 0 || results[0].values.length === 0) return undefined;

  const row = results[0].values[0];
  return {
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string | undefined,
    isActive: row[3] as number,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  };
}

export function getProjectDataSources(projectId: string): DataSourceRecord | undefined {
  return getDataSourceByProjectId(projectId);
}

export function getProjectDataSourceById(id: string): DataSourceRecord | undefined {
  return getDataSourceById(id);
}

export function createProjectDataSource(ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & { password: string }): DataSourceRecord {
  return createDataSource(ds);
}

export function updateProjectDataSource(id: string, ds: Partial<DataSourceRecord>): DataSourceRecord | undefined {
  return updateDataSource(id, ds);
}

export function deleteProjectDataSource(id: string) {
  deleteDataSource(id);
}

export function getProjectConfig(projectId: string): ProjectConfigRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM project_configs WHERE projectId = ?');
  stmt.bind([projectId]);

  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return {
      id: row[0] as string,
      projectId: row[1] as string,
      apiBaseUrl: row[2] as string | undefined,
      apiTokenPath: row[3] as string | undefined,
      apiVersionPath: row[4] as string | undefined,
      apiLogPath: row[5] as string | undefined,
      redisHost: row[6] as string | undefined,
      redisPort: row[7] as number | undefined,
      redisPassword: decryptPassword(row[8] as string),
      redisDb: row[9] as number | undefined,
      createdAt: row[10] as string,
      updatedAt: row[11] as string,
    };
  }

  stmt.free();
  return undefined;
}

export function createOrUpdateProjectConfig(config: Omit<ProjectConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): ProjectConfigRecord {
  const database = getDb();
  const existing = getProjectConfig(config.projectId);
  const now = new Date().toISOString();

  if (existing) {
    database.run(
      `UPDATE project_configs SET apiBaseUrl = ?, apiTokenPath = ?, apiVersionPath = ?, apiLogPath = ?, redisHost = ?, redisPort = ?, redisPassword = ?, redisDb = ?, updatedAt = ? WHERE projectId = ?`,
      [
        config.apiBaseUrl || null,
        config.apiTokenPath || null,
        config.apiVersionPath || null,
        config.apiLogPath || null,
        config.redisHost || null,
        config.redisPort || null,
        config.redisPassword ? encryptPassword(config.redisPassword) : null,
        config.redisDb || null,
        now,
        config.projectId,
      ]
    );
    saveDatabase();
    return { ...existing, ...config, updatedAt: now };
  } else {
    const id = uuidv4();
    database.run(
      `INSERT INTO project_configs (id, projectId, apiBaseUrl, apiTokenPath, apiVersionPath, apiLogPath, redisHost, redisPort, redisPassword, redisDb, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        config.projectId,
        config.apiBaseUrl || null,
        config.apiTokenPath || null,
        config.apiVersionPath || null,
        config.apiLogPath || null,
        config.redisHost || null,
        config.redisPort || null,
        config.redisPassword ? encryptPassword(config.redisPassword) : null,
        config.redisDb || null,
        now,
        now,
      ]
    );
    saveDatabase();
    return {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export function deleteProjectConfig(projectId: string) {
  const database = getDb();
  database.run('DELETE FROM project_configs WHERE projectId = ?', [projectId]);
  saveDatabase();
}

export function getActiveProjectWithDetails(): {
  project: ProjectRecord | undefined;
  dataSource: DataSourceRecord | undefined;
  config: ProjectConfigRecord | undefined;
} {
  const project = getActiveProject();
  if (!project) {
    return { project: undefined, dataSource: undefined, config: undefined };
  }

  const dataSource = getDataSourceByProjectId(project.id);
  const config = getProjectConfig(project.id);

  return { project, dataSource, config };
}

// ==================== Code Repository Functions ====================

export function getCodeRepositoriesByProjectId(projectId: string): CodeRepositoryRecord[] {
  const database = getDb();
  const results = database.exec('SELECT * FROM code_repositories WHERE projectId = ? ORDER BY name', [projectId]);
  if (results.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as string,
    projectId: row[1] as string,
    name: row[2] as string,
    repositoryUrl: row[3] as string,
    servicePatterns: row[4] as string,
    gitLabToken: row[5] ? decryptPassword(row[5] as string) : undefined,
    defaultBranch: row[6] as string | undefined,
    createdAt: row[7] as string,
    updatedAt: row[8] as string,
  }));
}

export function getCodeRepositoryById(id: string): CodeRepositoryRecord | undefined {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM code_repositories WHERE id = ?');
  stmt.bind([id]);

  if (stmt.step()) {
    const row = stmt.get();
    stmt.free();
    return {
      id: row[0] as string,
      projectId: row[1] as string,
      name: row[2] as string,
      repositoryUrl: row[3] as string,
      servicePatterns: row[4] as string,
      gitLabToken: row[5] ? decryptPassword(row[5] as string) : undefined,
      defaultBranch: row[6] as string | undefined,
      createdAt: row[7] as string,
      updatedAt: row[8] as string,
    };
  }

  stmt.free();
  return undefined;
}

export function matchCodeRepository(projectId: string, serviceName: string, requestUrl?: string): CodeRepositoryRecord | undefined {
  // 处理字符串 "undefined" 或 "null" 的情况
  const cleanServiceName = (serviceName === 'undefined' || serviceName === 'null') ? '' : serviceName;
  
  const repositories = getCodeRepositoriesByProjectId(projectId);
  const searchText = `${cleanServiceName} ${requestUrl || ''}`.toLowerCase();
  
  console.log('  [MATCH_REPO] Searching for:', { serviceName, cleanServiceName, requestUrl });
  console.log('  [MATCH_REPO] Search text:', searchText);

  if (repositories.length === 0) {
    console.log('  ❌ [MATCH_REPO] No repositories available');
    return undefined;
  }

  let bestMatch: CodeRepositoryRecord | undefined;
  let maxMatches = 0;
  const matchDetails: Array<{ name: string, matches: number, patterns: string[] }> = [];

  for (const repo of repositories) {
    const patterns = repo.servicePatterns.split(',').map(p => p.trim().toLowerCase()).filter(p => p);
    let matchCount = 0;
    const matchedPatterns: string[] = [];
    
    for (const pattern of patterns) {
      const forwardMatch = searchText.includes(pattern);
      const reverseMatch = pattern.includes(searchText);
      
      if (forwardMatch || reverseMatch) {
        matchCount++;
        matchedPatterns.push(pattern);
      }
    }
    
    matchDetails.push({ name: repo.name, matches: matchCount, patterns: matchedPatterns });
    
    if (matchCount > maxMatches) {
      maxMatches = matchCount;
      bestMatch = repo;
    }
  }
  
  console.log('  [MATCH_REPO] Match results:');
  for (const detail of matchDetails) {
    const isBest = bestMatch && detail.name === bestMatch.name;
    const indicator = isBest ? '⭐' : '  ';
    console.log(`    ${indicator} ${detail.name}: ${detail.matches} matches`, detail.patterns.length > 0 ? `(patterns: ${detail.patterns.join(', ')})` : '');
  }
  
  if (bestMatch) {
    console.log(`  ✅ [MATCH_REPO] Selected: "${bestMatch.name}" with ${maxMatches} matches`);
  } else {
    console.log('  ❌ [MATCH_REPO] No match found');
    console.log('  Available repositories:', repositories.map(r => ({ name: r.name, patterns: r.servicePatterns })));
  }
  
  return bestMatch;
}

export function createCodeRepository(repo: Omit<CodeRepositoryRecord, 'id' | 'createdAt' | 'updatedAt'>): CodeRepositoryRecord {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const encryptedToken = repo.gitLabToken ? encryptPassword(repo.gitLabToken) : null;

  database.run(
    `INSERT INTO code_repositories (id, projectId, name, repositoryUrl, servicePatterns, gitLabToken, defaultBranch, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, repo.projectId, repo.name, repo.repositoryUrl, repo.servicePatterns, encryptedToken, repo.defaultBranch || 'main', now, now]
  );

  saveDatabase();

  return {
    ...repo,
    id,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateCodeRepository(id: string, updates: Partial<CodeRepositoryRecord>): CodeRepositoryRecord | undefined {
  const database = getDb();
  const existing = getCodeRepositoryById(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated = { ...existing, ...updates, updatedAt: now };

  const encryptedToken = updated.gitLabToken ? encryptPassword(updated.gitLabToken) : null;

  database.run(
    `UPDATE code_repositories SET name = ?, repositoryUrl = ?, servicePatterns = ?, gitLabToken = ?, defaultBranch = ?, updatedAt = ? WHERE id = ?`,
    [
      updated.name,
      updated.repositoryUrl,
      updated.servicePatterns,
      encryptedToken,
      updated.defaultBranch || 'main',
      now,
      id,
    ]
  );

  saveDatabase();
  return updated;
}

export function deleteCodeRepository(id: string) {
  const database = getDb();
  database.run('DELETE FROM code_repositories WHERE id = ?', [id]);
  saveDatabase();
}

export function createDefaultCodeRepositories(projectId: string) {
  const database = getDb();
  
  const defaultRepos = [
    {
      name: '医嘱后端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-micro-pres-fj-common',
      servicePatterns: 'pres-service,prescription,医嘱'
    },
    {
      name: '收费后端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-micro-charge-fj-common',
      servicePatterns: 'charge-service,收费'
    },
    {
      name: '公共后端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-micro-optimus-fj-common',
      servicePatterns: 'optimus-service,common-service,公共'
    },
    {
      name: '临床路径前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-clinicpath-fj-common',
      servicePatterns: 'clinicpath,临床路径'
    },
    {
      name: '收费前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-his-charge-fj-common',
      servicePatterns: 'charge-web,收费前端'
    },
    {
      name: '药剂前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-his-drug-fj-common',
      servicePatterns: 'drug-web,药剂'
    },
    {
      name: '公共前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-his-fj-component',
      servicePatterns: 'component-web,公共前端'
    },
    {
      name: '门诊前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-outp-fj-common',
      servicePatterns: 'outp-web,门诊'
    },
    {
      name: '医嘱前端',
      repositoryUrl: 'http://gitlab.zoesoft.com.cn/onelink/fj-common/onelink-web-pres-fj-common',
      servicePatterns: 'pres-web,医嘱前端'
    }
  ];

  // 先获取该项目已有的仓库
  const existingRepos = getCodeRepositoriesByProjectId(projectId);
  const existingNames = new Set(existingRepos.map(repo => repo.name));

  for (const repo of defaultRepos) {
    // 只有当不存在时才添加
    if (!existingNames.has(repo.name)) {
      try {
        createCodeRepository({
          ...repo,
          projectId
        });
      } catch (e) {
        console.error('Failed to create default repo:', repo.name, e);
      }
    }
  }
}

export function inferBranchFromTag(tag: string): string {
  // 特殊情况：release-0开头的都是master
  if (tag.startsWith('release-0')) {
    return 'master';
  }
  
  // 一般情况：例如 release-1.168.28 -> release-1.168
  const match = tag.match(/^(release-\d+\.\d+)/);
  if (match) {
    return match[1];
  }
  
  // 如果无法匹配，返回master作为默认
  return 'master';
}

export function getGlobalConfig(): GlobalConfigRecord | undefined {
  const database = getDb();
  const result = database.exec('SELECT id, deepseekApiKey, deepseekBaseUrl, deepseekModel, createdAt, updatedAt, gitLabBaseUrl, gitLabToken FROM global_config LIMIT 1');
  if (result.length === 0 || result[0].values.length === 0) {
    return undefined;
  }
  
  const row = result[0].values[0];
  return {
    id: row[0] as string,
    deepseekApiKey: row[1] ? decryptPassword(row[1] as string) : undefined,
    deepseekBaseUrl: row[2] as string | undefined,
    deepseekModel: row[3] as string | undefined,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
    gitLabBaseUrl: row[6] as string | undefined,
    gitLabToken: row[7] ? decryptPassword(row[7] as string) : undefined,
  };
}

export function createOrUpdateGlobalConfig(config: Omit<GlobalConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): GlobalConfigRecord {
  const database = getDb();
  const now = new Date().toISOString();
  
  try {
    const existing = getGlobalConfig();
    
    if (existing) {
      const encryptedApiKey = config.deepseekApiKey ? encryptPassword(config.deepseekApiKey) : null;
      const encryptedGitLabToken = config.gitLabToken ? encryptPassword(config.gitLabToken) : null;
      database.run(
        `UPDATE global_config SET deepseekApiKey = ?, deepseekBaseUrl = ?, deepseekModel = ?, gitLabBaseUrl = ?, gitLabToken = ?, updatedAt = ? WHERE id = ?`,
        [encryptedApiKey, config.deepseekBaseUrl || null, config.deepseekModel || null, config.gitLabBaseUrl || null, encryptedGitLabToken, now, existing.id]
      );
      saveDatabase();
      
      return {
        ...existing,
        ...config,
        updatedAt: now,
      };
    } else {
      const id = uuidv4();
      const encryptedApiKey = config.deepseekApiKey ? encryptPassword(config.deepseekApiKey) : null;
      const encryptedGitLabToken = config.gitLabToken ? encryptPassword(config.gitLabToken) : null;
      database.run(
        `INSERT INTO global_config (id, deepseekApiKey, deepseekBaseUrl, deepseekModel, gitLabBaseUrl, gitLabToken, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, encryptedApiKey, config.deepseekBaseUrl || null, config.deepseekModel || null, config.gitLabBaseUrl || null, encryptedGitLabToken, now, now]
      );
      saveDatabase();
      
      return {
        id,
        ...config,
        createdAt: now,
        updatedAt: now,
      };
    }
  } catch (error) {
    console.error('Error creating or updating global config:', error);
    throw error;
  }
}
