"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_CACHE_VERSION = void 0;
exports.initDatabase = initDatabase;
exports.closeDatabase = closeDatabase;
exports.encryptPassword = encryptPassword;
exports.decryptPassword = decryptPassword;
exports.getAllDataSources = getAllDataSources;
exports.getDataSourceById = getDataSourceById;
exports.createDataSource = createDataSource;
exports.updateDataSource = updateDataSource;
exports.deleteDataSource = deleteDataSource;
exports.setActiveDataSource = setActiveDataSource;
exports.getActiveDataSource = getActiveDataSource;
exports.getQueryHistory = getQueryHistory;
exports.addQueryHistory = addQueryHistory;
exports.clearQueryHistory = clearQueryHistory;
exports.getSchemaCache = getSchemaCache;
exports.setSchemaCache = setSchemaCache;
exports.clearSchemaCache = clearSchemaCache;
exports.cleanOldSchemaCache = cleanOldSchemaCache;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const crypto_js_1 = __importDefault(require("crypto-js"));
const uuid_1 = require("uuid");
const ENCRYPTION_KEY = 'zoehis-helper-encryption-key-v1';
let db = null;
let dbPath = '';
function saveDatabase() {
    if (db) {
        try {
            const data = db.export();
            fs_1.default.writeFileSync(dbPath, Buffer.from(data));
            console.log('Database saved to:', dbPath);
        }
        catch (e) {
            console.error('Failed to save database:', e);
        }
    }
}
async function initDatabase() {
    console.log('Initializing database...');
    const userDataPath = electron_1.app.getPath('userData');
    dbPath = path_1.default.join(userDataPath, 'zoehis-helper.db');
    console.log('Database path:', dbPath);
    const SQL = await (0, sql_js_1.default)();
    if (fs_1.default.existsSync(dbPath)) {
        try {
            const buffer = fs_1.default.readFileSync(dbPath);
            db = new SQL.Database(buffer);
            console.log('Loaded existing database');
        }
        catch (e) {
            console.log('Failed to load existing database, creating new one');
            db = new SQL.Database();
        }
    }
    else {
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
function closeDatabase() {
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
function encryptPassword(password) {
    return crypto_js_1.default.AES.encrypt(password, ENCRYPTION_KEY).toString();
}
function decryptPassword(encrypted) {
    try {
        const bytes = crypto_js_1.default.AES.decrypt(encrypted, ENCRYPTION_KEY);
        return bytes.toString(crypto_js_1.default.enc.Utf8);
    }
    catch {
        return '';
    }
}
function getAllDataSources() {
    const database = getDb();
    const results = database.exec('SELECT * FROM data_sources ORDER BY name');
    if (results.length === 0)
        return [];
    return results[0].values.map((row) => ({
        id: row[0],
        name: row[1],
        type: row[2],
        host: row[3],
        port: row[4],
        sid: row[5],
        serviceName: row[6],
        schema: row[7],
        username: row[8],
        password: decryptPassword(row[9]),
        isActive: row[10],
        createdAt: row[11],
        updatedAt: row[12],
    }));
}
function getDataSourceById(id) {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM data_sources WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
            id: row[0],
            name: row[1],
            type: row[2],
            host: row[3],
            port: row[4],
            sid: row[5],
            serviceName: row[6],
            schema: row[7],
            username: row[8],
            password: decryptPassword(row[9]),
            isActive: row[10],
            createdAt: row[11],
            updatedAt: row[12],
        };
    }
    stmt.free();
    return undefined;
}
function createDataSource(ds) {
    const database = getDb();
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const encryptedPassword = encryptPassword(ds.password);
    database.run(`INSERT INTO data_sources (id, name, type, host, port, sid, serviceName, schema, username, password, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, ds.name, ds.type, ds.host, ds.port, ds.sid || null, ds.serviceName || null, ds.schema || null, ds.username, encryptedPassword, ds.isActive || 0, now, now]);
    saveDatabase();
    return {
        ...ds,
        id,
        password: ds.password,
        createdAt: now,
        updatedAt: now,
    };
}
function updateDataSource(id, ds) {
    const database = getDb();
    const existing = getDataSourceById(id);
    if (!existing)
        return undefined;
    const now = new Date().toISOString();
    const updated = { ...existing, ...ds, updatedAt: now };
    if (ds.password) {
        updated.password = ds.password;
    }
    const encryptedPassword = encryptPassword(updated.password);
    database.run(`UPDATE data_sources SET name = ?, type = ?, host = ?, port = ?, sid = ?, serviceName = ?, schema = ?, username = ?, password = ?, isActive = ?, updatedAt = ? WHERE id = ?`, [updated.name, updated.type, updated.host, updated.port, updated.sid || null, updated.serviceName || null, updated.schema || null, updated.username, encryptedPassword, updated.isActive, now, id]);
    saveDatabase();
    return updated;
}
function deleteDataSource(id) {
    const database = getDb();
    database.run('DELETE FROM data_sources WHERE id = ?', [id]);
    saveDatabase();
}
function setActiveDataSource(id) {
    const database = getDb();
    database.run('UPDATE data_sources SET isActive = 0');
    database.run('UPDATE data_sources SET isActive = 1 WHERE id = ?', [id]);
    saveDatabase();
}
function getActiveDataSource() {
    const database = getDb();
    const results = database.exec('SELECT * FROM data_sources WHERE isActive = 1');
    if (results.length === 0 || results[0].values.length === 0)
        return undefined;
    const row = results[0].values[0];
    return {
        id: row[0],
        name: row[1],
        type: row[2],
        host: row[3],
        port: row[4],
        sid: row[5],
        serviceName: row[6],
        schema: row[7],
        username: row[8],
        password: decryptPassword(row[9]),
        isActive: row[10],
        createdAt: row[11],
        updatedAt: row[12],
    };
}
function getQueryHistory(limit = 100) {
    const database = getDb();
    const results = database.exec(`SELECT * FROM query_history ORDER BY executedAt DESC LIMIT ${limit}`);
    if (results.length === 0)
        return [];
    return results[0].values.map((row) => ({
        id: row[0],
        sql: row[1],
        executedAt: row[2],
        executionTime: row[3],
        rowCount: row[4],
        dataSourceId: row[5],
        dataSourceName: row[6],
    }));
}
function addQueryHistory(history) {
    const database = getDb();
    const id = (0, uuid_1.v4)();
    database.run(`INSERT INTO query_history (id, sql, executedAt, executionTime, rowCount, dataSourceId, dataSourceName) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, history.sql, history.executedAt, history.executionTime, history.rowCount, history.dataSourceId, history.dataSourceName]);
    saveDatabase();
}
function clearQueryHistory() {
    const database = getDb();
    database.run('DELETE FROM query_history');
    saveDatabase();
}
exports.SCHEMA_CACHE_VERSION = 'v2';
function getSchemaCache(dataSourceId, filterPattern, matchAnyFilter = false) {
    const database = getDb();
    let query;
    let params;
    if (matchAnyFilter) {
        query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? AND version = ? ORDER BY cachedAt DESC';
        params = [dataSourceId, exports.SCHEMA_CACHE_VERSION];
    }
    else {
        query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? AND (filterPattern = ? OR (filterPattern IS NULL AND ? IS NULL)) AND version = ? ORDER BY cachedAt DESC LIMIT 1';
        const bindFilter = filterPattern || null;
        params = [dataSourceId, bindFilter, bindFilter, exports.SCHEMA_CACHE_VERSION];
    }
    const stmt = database.prepare(query);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        const row = stmt.get();
        try {
            results.push({
                id: row[0],
                dataSourceId: row[1],
                schemaData: JSON.parse(row[2]),
                filterPattern: row[3],
                cachedAt: row[4],
                version: row[5],
            });
        }
        catch {
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
    const mergedSchemaData = [];
    const seenTables = new Set();
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
function setSchemaCache(dataSourceId, schemaData, filterPattern) {
    const database = getDb();
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const schemaJson = JSON.stringify(schemaData);
    database.run(`INSERT INTO schema_cache (id, dataSourceId, schemaData, filterPattern, cachedAt, version)
     VALUES (?, ?, ?, ?, ?, ?)`, [id, dataSourceId, schemaJson, filterPattern || null, now, exports.SCHEMA_CACHE_VERSION]);
    saveDatabase();
    return { id, cachedAt: now };
}
function clearSchemaCache(dataSourceId) {
    const database = getDb();
    if (dataSourceId) {
        database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    }
    else {
        database.run('DELETE FROM schema_cache');
    }
    saveDatabase();
}
function cleanOldSchemaCache(keepDays = 30) {
    const database = getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    const cutoffStr = cutoffDate.toISOString();
    database.run('DELETE FROM schema_cache WHERE cachedAt < ?', [cutoffStr]);
    saveDatabase();
}
