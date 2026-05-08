import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';

const ENCRYPTION_KEY = 'zoehis-helper-encryption-key-v1';

export interface DataSourceRecord {
  id: string;
  name: string;
  type: 'oracle' | 'dameng';
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  schema?: string;
  username: string;
  password: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

let db: SqlJsDatabase | null = null;
let dbPath: string = '';

function saveDatabase() {
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

export async function initDatabase() {
  console.log('Initializing database...');

  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'zoehis-helper.db');
  console.log('Database path:', dbPath);

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    try {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log('Loaded existing database');
    } catch (e) {
      console.log('Failed to load existing database, creating new one');
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      sid TEXT,
      serviceName TEXT,
      schema TEXT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      isActive INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
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
      version TEXT NOT NULL,
      FOREIGN KEY (dataSourceId) REFERENCES data_sources(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_schema_cache_dataSourceId ON schema_cache(dataSourceId)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_schema_cache_dataSourceId_filter ON schema_cache(dataSourceId, filterPattern)
  `);

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

function getDb() {
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
    name: row[1] as string,
    type: row[2] as 'oracle' | 'dameng',
    host: row[3] as string,
    port: row[4] as number,
    sid: row[5] as string | undefined,
    serviceName: row[6] as string | undefined,
    schema: row[7] as string | undefined,
    username: row[8] as string,
    password: decryptPassword(row[9] as string),
    isActive: row[10] as number,
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
      name: row[1] as string,
      type: row[2] as 'oracle' | 'dameng',
      host: row[3] as string,
      port: row[4] as number,
      sid: row[5] as string | undefined,
      serviceName: row[6] as string | undefined,
      schema: row[7] as string | undefined,
      username: row[8] as string,
      password: decryptPassword(row[9] as string),
      isActive: row[10] as number,
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
    `INSERT INTO data_sources (id, name, type, host, port, sid, serviceName, schema, username, password, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ds.name, ds.type, ds.host, ds.port, ds.sid || null, ds.serviceName || null, ds.schema || null, ds.username, encryptedPassword, ds.isActive || 0, now, now]
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
    `UPDATE data_sources SET name = ?, type = ?, host = ?, port = ?, sid = ?, serviceName = ?, schema = ?, username = ?, password = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    [updated.name, updated.type, updated.host, updated.port, updated.sid || null, updated.serviceName || null, updated.schema || null, updated.username, encryptedPassword, updated.isActive, now, id]
  );

  saveDatabase();
  return updated;
}

export function deleteDataSource(id: string) {
  const database = getDb();
  database.run('DELETE FROM data_sources WHERE id = ?', [id]);
  saveDatabase();
}

export function setActiveDataSource(id: string) {
  const database = getDb();
  database.run('UPDATE data_sources SET isActive = 0');
  database.run('UPDATE data_sources SET isActive = 1 WHERE id = ?', [id]);
  saveDatabase();
}

export function getActiveDataSource(): DataSourceRecord | undefined {
  const database = getDb();
  const results = database.exec('SELECT * FROM data_sources WHERE isActive = 1');
  if (results.length === 0 || results[0].values.length === 0) return undefined;

  const row = results[0].values[0];
  return {
    id: row[0] as string,
    name: row[1] as string,
    type: row[2] as 'oracle' | 'dameng',
    host: row[3] as string,
    port: row[4] as number,
    sid: row[5] as string | undefined,
    serviceName: row[6] as string | undefined,
    schema: row[7] as string | undefined,
    username: row[8] as string,
    password: decryptPassword(row[9] as string),
    isActive: row[10] as number,
    createdAt: row[11] as string,
    updatedAt: row[12] as string,
  };
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

export const SCHEMA_CACHE_VERSION = 'v2';

export function getSchemaCache(dataSourceId: string, filterPattern?: string, matchAnyFilter: boolean = false): any | undefined {
  const database = getDb();
  
  let query: string;
  let params: any[];
  
  if (matchAnyFilter) {
    query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? AND version = ? ORDER BY cachedAt DESC';
    params = [dataSourceId, SCHEMA_CACHE_VERSION];
  } else {
    query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? AND (filterPattern = ? OR (filterPattern IS NULL AND ? IS NULL)) AND version = ? ORDER BY cachedAt DESC LIMIT 1';
    const bindFilter = filterPattern || null;
    params = [dataSourceId, bindFilter, bindFilter, SCHEMA_CACHE_VERSION];
  }
  
  const stmt = database.prepare(query);
  stmt.bind(params);

  const results: any[] = [];
  while (stmt.step()) {
    const row = stmt.get();
    try {
      results.push({
        id: row[0] as string,
        dataSourceId: row[1] as string,
        schemaData: JSON.parse(row[2] as string),
        filterPattern: row[3] as string | null,
        cachedAt: row[4] as string,
        version: row[5] as string,
      });
    } catch {
      // skip invalid JSON
    }
  }
  
  stmt.free();
  
  if (results.length === 0) {
    return undefined;
  }
  
  if (!matchAnyFilter || results.length === 1) {
    return results[0];
  }
  
  const mergedSchemaData: any[] = [];
  const seenTables = new Set<string>();
  
  for (const result of results) {
    for (const table of result.schemaData) {
      if (!seenTables.has(table.tableName)) {
        seenTables.add(table.tableName);
        mergedSchemaData.push(table);
      }
    }
  }
  
  return {
    id: results[0].id,
    dataSourceId: results[0].dataSourceId,
    schemaData: mergedSchemaData,
    filterPattern: null,
    cachedAt: results[0].cachedAt,
    version: results[0].version,
  };
}

export function setSchemaCache(dataSourceId: string, schemaData: any[], filterPattern?: string) {
  const database = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const schemaJson = JSON.stringify(schemaData);

  database.run(
    `INSERT INTO schema_cache (id, dataSourceId, schemaData, filterPattern, cachedAt, version)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, dataSourceId, schemaJson, filterPattern || null, now, SCHEMA_CACHE_VERSION]
  );

  saveDatabase();
  return { id, cachedAt: now };
}

export function clearSchemaCache(dataSourceId?: string) {
  const database = getDb();
  if (dataSourceId) {
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
  } else {
    database.run('DELETE FROM schema_cache');
  }
  saveDatabase();
}

export function cleanOldSchemaCache(keepDays: number = 30) {
  const database = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);
  const cutoffStr = cutoffDate.toISOString();

  database.run('DELETE FROM schema_cache WHERE cachedAt < ?', [cutoffStr]);
  saveDatabase();
}
