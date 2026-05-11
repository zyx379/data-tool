"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.closeDatabase = closeDatabase;
exports.encryptPassword = encryptPassword;
exports.decryptPassword = decryptPassword;
exports.getAllDataSources = getAllDataSources;
exports.getDataSourceById = getDataSourceById;
exports.createDataSource = createDataSource;
exports.updateDataSource = updateDataSource;
exports.deleteDataSource = deleteDataSource;
exports.getDataSourceByProjectId = getDataSourceByProjectId;
exports.getActiveDataSource = getActiveDataSource;
exports.getQueryHistory = getQueryHistory;
exports.addQueryHistory = addQueryHistory;
exports.clearQueryHistory = clearQueryHistory;
exports.getSchemaCache = getSchemaCache;
exports.setSchemaCache = setSchemaCache;
exports.clearSchemaCache = clearSchemaCache;
exports.cleanOldSchemaCache = cleanOldSchemaCache;
exports.removeTableFromSchemaCache = removeTableFromSchemaCache;
exports.removeTablesFromSchemaCache = removeTablesFromSchemaCache;
exports.getAllProjects = getAllProjects;
exports.getProjectById = getProjectById;
exports.createProject = createProject;
exports.updateProject = updateProject;
exports.deleteProject = deleteProject;
exports.setActiveProject = setActiveProject;
exports.getActiveProject = getActiveProject;
exports.getProjectDataSources = getProjectDataSources;
exports.getProjectDataSourceById = getProjectDataSourceById;
exports.createProjectDataSource = createProjectDataSource;
exports.updateProjectDataSource = updateProjectDataSource;
exports.deleteProjectDataSource = deleteProjectDataSource;
exports.getProjectConfig = getProjectConfig;
exports.createOrUpdateProjectConfig = createOrUpdateProjectConfig;
exports.deleteProjectConfig = deleteProjectConfig;
exports.getActiveProjectWithDetails = getActiveProjectWithDetails;
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
            // 检查 data_sources 表是否有 projectId 列
            try {
                const result = db.exec("PRAGMA table_info(data_sources)");
                if (result.length > 0) {
                    const columns = result[0].values.map(col => col[1]);
                    if (!columns.includes('projectId')) {
                        console.log('Migrating data_sources table to new schema...');
                        // 保存 schema_cache 数据
                        let schemaCacheData = [];
                        try {
                            const cacheResult = db.exec("SELECT * FROM schema_cache");
                            if (cacheResult.length > 0) {
                                schemaCacheData = cacheResult[0].values;
                            }
                            console.log('Saved', schemaCacheData.length, 'schema cache records to preserve');
                        }
                        catch (e) {
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
                                }
                                catch (e) {
                                    console.log('Error restoring cache record, skipping:', e);
                                }
                            }
                        }
                        // 保存数据库
                        saveDatabase();
                        console.log('Migration completed');
                    }
                }
            }
            catch (checkError) {
                console.log('Error checking/migrating table structure:', checkError);
            }
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
    // 调试：查询现有 schema_cache
    try {
        const result = db.exec('SELECT dataSourceId, filterPattern, cachedAt FROM schema_cache ORDER BY cachedAt DESC');
        if (result.length > 0 && result[0].values.length > 0) {
            console.log('[DEBUG] Existing schema_cache entries:');
            result[0].values.forEach((row, index) => {
                console.log(`[DEBUG]   ${index + 1}: dataSourceId=${row[0]}, filterPattern=${row[1]}, cachedAt=${row[2]}`);
            });
        }
        else {
            console.log('[DEBUG] No existing schema_cache entries found');
        }
    }
    catch (e) {
        console.log('[DEBUG] Error checking schema_cache:', e);
    }
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
        projectId: row[1],
        name: row[2],
        type: row[3],
        host: row[4],
        port: row[5],
        sid: row[6],
        serviceName: row[7],
        schema: row[8],
        username: row[9],
        password: decryptPassword(row[10]),
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
            projectId: row[1],
            name: row[2],
            type: row[3],
            host: row[4],
            port: row[5],
            sid: row[6],
            serviceName: row[7],
            schema: row[8],
            username: row[9],
            password: decryptPassword(row[10]),
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
    database.run(`INSERT INTO data_sources (id, projectId, name, type, host, port, sid, serviceName, schema, username, password, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, ds.projectId, ds.name, ds.type, ds.host, ds.port, ds.sid || null, ds.serviceName || null, ds.schema || null, ds.username, encryptedPassword, now, now]);
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
    database.run(`UPDATE data_sources SET projectId = ?, name = ?, type = ?, host = ?, port = ?, sid = ?, serviceName = ?, schema = ?, username = ?, password = ?, updatedAt = ? WHERE id = ?`, [updated.projectId, updated.name, updated.type, updated.host, updated.port, updated.sid || null, updated.serviceName || null, updated.schema || null, updated.username, encryptedPassword, now, id]);
    saveDatabase();
    return updated;
}
function deleteDataSource(id) {
    const database = getDb();
    database.run('DELETE FROM data_sources WHERE id = ?', [id]);
    saveDatabase();
}
function getDataSourceByProjectId(projectId) {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM data_sources WHERE projectId = ?');
    stmt.bind([projectId]);
    if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
            id: row[0],
            projectId: row[1],
            name: row[2],
            type: row[3],
            host: row[4],
            port: row[5],
            sid: row[6],
            serviceName: row[7],
            schema: row[8],
            username: row[9],
            password: decryptPassword(row[10]),
            createdAt: row[11],
            updatedAt: row[12],
        };
    }
    stmt.free();
    return undefined;
}
function getActiveDataSource() {
    const project = getActiveProject();
    if (!project)
        return undefined;
    return getDataSourceByProjectId(project.id);
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
function getSchemaCache(dataSourceId, filterPattern, matchAnyFilter = false) {
    console.log('[DEBUG] getSchemaCache called with:');
    console.log('[DEBUG]   dataSourceId:', dataSourceId);
    console.log('[DEBUG]   filterPattern:', filterPattern);
    console.log('[DEBUG]   matchAnyFilter:', matchAnyFilter);
    const database = getDb();
    let query;
    let params;
    const results = [];
    if (matchAnyFilter) {
        query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? ORDER BY cachedAt DESC';
        params = [dataSourceId];
    }
    else {
        query = 'SELECT * FROM schema_cache WHERE dataSourceId = ? AND (filterPattern = ? OR (filterPattern IS NULL AND ? IS NULL)) ORDER BY cachedAt DESC LIMIT 1';
        const bindFilter = filterPattern || null;
        params = [dataSourceId, bindFilter, bindFilter];
    }
    console.log('[DEBUG] Query:', query);
    console.log('[DEBUG] Params:', params);
    const stmt = database.prepare(query);
    stmt.bind(params);
    while (stmt.step()) {
        const row = stmt.get();
        try {
            results.push({
                id: row[0],
                dataSourceId: row[1],
                schemaData: JSON.parse(row[2]),
                filterPattern: row[3],
                cachedAt: row[4],
            });
        }
        catch (e) {
            console.error('[DEBUG] Error parsing schemaData JSON:', e);
        }
    }
    stmt.free();
    console.log('[DEBUG] Found', results.length, 'cache results');
    if (results.length === 0) {
        console.log('[DEBUG] No cache results found, returning undefined');
        return undefined;
    }
    if (!matchAnyFilter || results.length === 1) {
        console.log('[DEBUG] Returning single result with', results[0].schemaData?.length, 'tables');
        return results[0];
    }
    console.log('[DEBUG] Merging multiple cache results');
    const mergedSchemaData = [];
    const seenTables = new Set();
    for (const result of results) {
        console.log('[DEBUG] Processing result with', result.schemaData?.length, 'tables');
        for (const table of result.schemaData) {
            if (!seenTables.has(table.tableName)) {
                seenTables.add(table.tableName);
                mergedSchemaData.push(table);
            }
        }
    }
    console.log('[DEBUG] Merged result has', mergedSchemaData.length, 'unique tables');
    return {
        id: results[0].id,
        dataSourceId: results[0].dataSourceId,
        schemaData: mergedSchemaData,
        filterPattern: null,
        cachedAt: results[0].cachedAt,
    };
}
function setSchemaCache(dataSourceId, schemaData, filterPattern) {
    console.log('[DEBUG] ========== setSchemaCache START ==========');
    console.log('[DEBUG] dataSourceId:', dataSourceId);
    console.log('[DEBUG] schemaData.length:', schemaData.length);
    console.log('[DEBUG] filterPattern:', filterPattern);
    const database = getDb();
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const schemaJson = JSON.stringify(schemaData);
    // 先删除相同 dataSourceId 和 filterPattern 的旧缓存
    console.log('[DEBUG] Deleting old cache entries...');
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ? AND (filterPattern = ? OR (filterPattern IS NULL AND ? IS NULL))', [dataSourceId, filterPattern || null, filterPattern || null]);
    console.log('[DEBUG] Inserting new cache with id:', id);
    database.run(`INSERT INTO schema_cache (id, dataSourceId, schemaData, filterPattern, cachedAt, version)
     VALUES (?, ?, ?, ?, ?, ?)`, [id, dataSourceId, schemaJson, filterPattern || null, now, 'v2']);
    console.log('[DEBUG] Calling saveDatabase()...');
    saveDatabase();
    console.log('[DEBUG] ========== setSchemaCache COMPLETE ==========');
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
function removeTableFromSchemaCache(dataSourceId, tableName) {
    const database = getDb();
    const allCaches = getSchemaCache(dataSourceId, undefined, true);
    if (!allCaches)
        return;
    const schemaArray = Array.isArray(allCaches.schemaData) ? allCaches.schemaData : [];
    const filteredSchema = schemaArray.filter((table) => table.tableName !== tableName);
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    saveDatabase();
    if (filteredSchema.length > 0) {
        setSchemaCache(dataSourceId, filteredSchema, undefined);
    }
}
function removeTablesFromSchemaCache(dataSourceId, tableNames) {
    const database = getDb();
    const allCaches = getSchemaCache(dataSourceId, undefined, true);
    if (!allCaches)
        return;
    const schemaArray = Array.isArray(allCaches.schemaData) ? allCaches.schemaData : [];
    const tableNameSet = new Set(tableNames);
    const filteredSchema = schemaArray.filter((table) => !tableNameSet.has(table.tableName));
    database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    saveDatabase();
    if (filteredSchema.length > 0) {
        setSchemaCache(dataSourceId, filteredSchema, undefined);
    }
}
function getAllProjects() {
    const database = getDb();
    const results = database.exec('SELECT * FROM projects ORDER BY createdAt DESC');
    if (results.length === 0 || results[0].values.length === 0)
        return [];
    return results[0].values.map((row) => ({
        id: row[0],
        name: row[1],
        description: row[2],
        isActive: row[3],
        createdAt: row[4],
        updatedAt: row[5],
    }));
}
function getProjectById(id) {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM projects WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
            id: row[0],
            name: row[1],
            description: row[2],
            isActive: row[3],
            createdAt: row[4],
            updatedAt: row[5],
        };
    }
    stmt.free();
    return undefined;
}
function createProject(project) {
    const database = getDb();
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    database.run(`INSERT INTO projects (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`, [id, project.name, project.description || null, project.isActive || 0, now, now]);
    saveDatabase();
    return {
        ...project,
        id,
        createdAt: now,
        updatedAt: now,
    };
}
function updateProject(id, updates) {
    const database = getDb();
    const existing = getProjectById(id);
    if (!existing)
        return undefined;
    const now = new Date().toISOString();
    const updated = { ...existing, ...updates, updatedAt: now };
    database.run(`UPDATE projects SET name = ?, description = ?, isActive = ?, updatedAt = ? WHERE id = ?`, [updated.name, updated.description || null, updated.isActive, now, id]);
    saveDatabase();
    return updated;
}
function deleteProject(id) {
    const database = getDb();
    database.run('DELETE FROM projects WHERE id = ?', [id]);
    saveDatabase();
}
function setActiveProject(id) {
    const database = getDb();
    database.run('UPDATE projects SET isActive = 0');
    database.run('UPDATE projects SET isActive = 1 WHERE id = ?', [id]);
    saveDatabase();
}
function getActiveProject() {
    const database = getDb();
    const results = database.exec('SELECT * FROM projects WHERE isActive = 1');
    if (results.length === 0 || results[0].values.length === 0)
        return undefined;
    const row = results[0].values[0];
    return {
        id: row[0],
        name: row[1],
        description: row[2],
        isActive: row[3],
        createdAt: row[4],
        updatedAt: row[5],
    };
}
function getProjectDataSources(projectId) {
    return getDataSourceByProjectId(projectId);
}
function getProjectDataSourceById(id) {
    return getDataSourceById(id);
}
function createProjectDataSource(ds) {
    return createDataSource(ds);
}
function updateProjectDataSource(id, ds) {
    return updateDataSource(id, ds);
}
function deleteProjectDataSource(id) {
    deleteDataSource(id);
}
function getProjectConfig(projectId) {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM project_configs WHERE projectId = ?');
    stmt.bind([projectId]);
    if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
            id: row[0],
            projectId: row[1],
            apiBaseUrl: row[2],
            apiTokenPath: row[3],
            apiVersionPath: row[4],
            apiLogPath: row[5],
            redisHost: row[6],
            redisPort: row[7],
            redisPassword: decryptPassword(row[8]),
            redisDb: row[9],
            createdAt: row[10],
            updatedAt: row[11],
        };
    }
    stmt.free();
    return undefined;
}
function createOrUpdateProjectConfig(config) {
    const database = getDb();
    const existing = getProjectConfig(config.projectId);
    const now = new Date().toISOString();
    if (existing) {
        database.run(`UPDATE project_configs SET apiBaseUrl = ?, apiTokenPath = ?, apiVersionPath = ?, apiLogPath = ?, redisHost = ?, redisPort = ?, redisPassword = ?, redisDb = ?, updatedAt = ? WHERE projectId = ?`, [
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
        ]);
        saveDatabase();
        return { ...existing, ...config, updatedAt: now };
    }
    else {
        const id = (0, uuid_1.v4)();
        database.run(`INSERT INTO project_configs (id, projectId, apiBaseUrl, apiTokenPath, apiVersionPath, apiLogPath, redisHost, redisPort, redisPassword, redisDb, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
        ]);
        saveDatabase();
        return {
            ...config,
            id,
            createdAt: now,
            updatedAt: now,
        };
    }
}
function deleteProjectConfig(projectId) {
    const database = getDb();
    database.run('DELETE FROM project_configs WHERE projectId = ?', [projectId]);
    saveDatabase();
}
function getActiveProjectWithDetails() {
    const project = getActiveProject();
    if (!project) {
        return { project: undefined, dataSource: undefined, config: undefined };
    }
    const dataSource = getDataSourceByProjectId(project.id);
    const config = getProjectConfig(project.id);
    return { project, dataSource, config };
}
