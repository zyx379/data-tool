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
exports.getCodeRepositoriesByProjectId = getCodeRepositoriesByProjectId;
exports.getCodeRepositoryById = getCodeRepositoryById;
exports.matchCodeRepository = matchCodeRepository;
exports.createCodeRepository = createCodeRepository;
exports.updateCodeRepository = updateCodeRepository;
exports.deleteCodeRepository = deleteCodeRepository;
exports.createDefaultCodeRepositories = createDefaultCodeRepositories;
exports.inferBranchFromTag = inferBranchFromTag;
exports.getGlobalConfig = getGlobalConfig;
exports.createOrUpdateGlobalConfig = createOrUpdateGlobalConfig;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const crypto_js_1 = __importDefault(require("crypto-js"));
const uuid_1 = require("uuid");
const schemaCacheFiles_1 = require("./schemaCacheFiles");
const schemaMerge_1 = require("./schemaMerge");
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
/** 将旧版 SQLite schema_cache 一次性迁出到 userData/schema-cache/{id}.json */
function migrateSchemaCacheFromSqliteToFiles() {
    if (!db)
        return;
    try {
        (0, schemaCacheFiles_1.ensureSchemaCacheDir)();
        const database = db;
        const stmt = database.prepare('SELECT dataSourceId, schemaData FROM schema_cache');
        const byId = new Map();
        while (stmt.step()) {
            const row = stmt.get();
            const dsId = row[0];
            let tables;
            try {
                tables = JSON.parse(row[1]);
            }
            catch {
                continue;
            }
            if (!Array.isArray(tables))
                continue;
            const prev = byId.get(dsId) || [];
            byId.set(dsId, (0, schemaMerge_1.mergeSchemaIncremental)(prev, tables));
        }
        stmt.free();
        if (byId.size === 0) {
            return;
        }
        for (const [dsId, tables] of byId) {
            (0, schemaCacheFiles_1.writeSchemaCacheToFile)(dsId, tables);
        }
        database.run('DELETE FROM schema_cache');
        console.log('[schema-cache] Migrated', byId.size, 'data source(s) from SQLite to JSON files');
    }
    catch (e) {
        console.error('[schema-cache] SQLite migration failed:', e);
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
    // 添加默认的代码仓库配置（用于新用户快速上手）
    // 检查是否已有数据，避免重复添加
    try {
        const checkResult = db.exec('SELECT COUNT(*) as cnt FROM code_repositories');
        if (checkResult.length > 0 && checkResult[0].values.length > 0 && checkResult[0].values[0][0] === 0) {
            console.log('Initializing default code repositories...');
            // 这里会在前端首次使用时添加，不在数据库初始化时添加
        }
    }
    catch (e) {
        // 忽略检查错误
    }
    (0, schemaCacheFiles_1.ensureSchemaCacheDir)();
    migrateSchemaCacheFromSqliteToFiles();
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
    (0, schemaCacheFiles_1.deleteSchemaCacheFile)(id);
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
    (0, schemaCacheFiles_1.ensureSchemaCacheDir)();
    void filterPattern;
    void matchAnyFilter;
    let filePayload = (0, schemaCacheFiles_1.readSchemaCacheFromFile)(dataSourceId);
    if (!filePayload) {
        migrateSchemaCacheFromSqliteToFiles();
        filePayload = (0, schemaCacheFiles_1.readSchemaCacheFromFile)(dataSourceId);
    }
    if (!filePayload)
        return undefined;
    return {
        id: dataSourceId,
        dataSourceId,
        schemaData: filePayload.tables,
        filterPattern: null,
        cachedAt: filePayload.cachedAt,
    };
}
function setSchemaCache(dataSourceId, schemaData, filterPattern) {
    void filterPattern;
    console.log('[schema-cache] setSchemaCache', dataSourceId, 'table count:', schemaData.length);
    (0, schemaCacheFiles_1.writeSchemaCacheToFile)(dataSourceId, schemaData);
    const database = getDb();
    try {
        database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    }
    catch (e) {
        console.warn('[schema-cache] cleanup SQLite rows:', e);
    }
    saveDatabase();
    return { id: dataSourceId, cachedAt: new Date().toISOString() };
}
function clearSchemaCache(dataSourceId) {
    if (dataSourceId) {
        (0, schemaCacheFiles_1.deleteSchemaCacheFile)(dataSourceId);
        const database = getDb();
        database.run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
    }
    else {
        try {
            const dir = (0, schemaCacheFiles_1.getSchemaCacheDir)();
            if (fs_1.default.existsSync(dir)) {
                for (const name of fs_1.default.readdirSync(dir)) {
                    if (name.endsWith('.json')) {
                        fs_1.default.unlinkSync(path_1.default.join(dir, name));
                    }
                }
            }
        }
        catch (e) {
            console.error('[schema-cache] clear all files:', e);
        }
        const database = getDb();
        database.run('DELETE FROM schema_cache');
    }
    saveDatabase();
}
function cleanOldSchemaCache(keepDays = 30) {
    const cutoff = Date.now() - keepDays * 86400000;
    try {
        (0, schemaCacheFiles_1.ensureSchemaCacheDir)();
        const dir = (0, schemaCacheFiles_1.getSchemaCacheDir)();
        if (fs_1.default.existsSync(dir)) {
            for (const name of fs_1.default.readdirSync(dir)) {
                if (!name.endsWith('.json'))
                    continue;
                const fp = path_1.default.join(dir, name);
                const st = fs_1.default.statSync(fp);
                if (st.mtimeMs < cutoff) {
                    fs_1.default.unlinkSync(fp);
                }
            }
        }
    }
    catch (e) {
        console.error('[schema-cache] cleanOldSchemaCache files:', e);
    }
    const database = getDb();
    database.run('DELETE FROM schema_cache WHERE cachedAt < ?', [new Date(cutoff).toISOString()]);
    saveDatabase();
}
function removeTableFromSchemaCache(dataSourceId, tableName) {
    const payload = (0, schemaCacheFiles_1.readSchemaCacheFromFile)(dataSourceId);
    if (!payload)
        return;
    const schemaArray = Array.isArray(payload.tables) ? payload.tables : [];
    const filteredSchema = schemaArray.filter((table) => (0, schemaMerge_1.schemaTableKey)(table.tableName) !== (0, schemaMerge_1.schemaTableKey)(tableName));
    if (filteredSchema.length === schemaArray.length)
        return;
    if (filteredSchema.length > 0) {
        (0, schemaCacheFiles_1.writeSchemaCacheToFile)(dataSourceId, filteredSchema);
    }
    else {
        (0, schemaCacheFiles_1.deleteSchemaCacheFile)(dataSourceId);
    }
    try {
        getDb().run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
        saveDatabase();
    }
    catch {
        /* ignore */
    }
}
function removeTablesFromSchemaCache(dataSourceId, tableNames) {
    const payload = (0, schemaCacheFiles_1.readSchemaCacheFromFile)(dataSourceId);
    if (!payload)
        return;
    const keySet = new Set(tableNames.map((n) => (0, schemaMerge_1.schemaTableKey)(n)));
    const schemaArray = Array.isArray(payload.tables) ? payload.tables : [];
    const filteredSchema = schemaArray.filter((table) => !keySet.has((0, schemaMerge_1.schemaTableKey)(table.tableName)));
    if (filteredSchema.length === schemaArray.length)
        return;
    if (filteredSchema.length > 0) {
        (0, schemaCacheFiles_1.writeSchemaCacheToFile)(dataSourceId, filteredSchema);
    }
    else {
        (0, schemaCacheFiles_1.deleteSchemaCacheFile)(dataSourceId);
    }
    try {
        getDb().run('DELETE FROM schema_cache WHERE dataSourceId = ?', [dataSourceId]);
        saveDatabase();
    }
    catch {
        /* ignore */
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
// ==================== Code Repository Functions ====================
function getCodeRepositoriesByProjectId(projectId) {
    const database = getDb();
    const results = database.exec('SELECT * FROM code_repositories WHERE projectId = ? ORDER BY name', [projectId]);
    if (results.length === 0)
        return [];
    return results[0].values.map((row) => ({
        id: row[0],
        projectId: row[1],
        name: row[2],
        repositoryUrl: row[3],
        servicePatterns: row[4],
        gitLabToken: row[5] ? decryptPassword(row[5]) : undefined,
        defaultBranch: row[6],
        createdAt: row[7],
        updatedAt: row[8],
    }));
}
function getCodeRepositoryById(id) {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM code_repositories WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
            id: row[0],
            projectId: row[1],
            name: row[2],
            repositoryUrl: row[3],
            servicePatterns: row[4],
            gitLabToken: row[5] ? decryptPassword(row[5]) : undefined,
            defaultBranch: row[6],
            createdAt: row[7],
            updatedAt: row[8],
        };
    }
    stmt.free();
    return undefined;
}
function matchCodeRepository(projectId, serviceName, requestUrl) {
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
    let bestMatch;
    let maxMatches = 0;
    const matchDetails = [];
    for (const repo of repositories) {
        const patterns = repo.servicePatterns.split(',').map(p => p.trim().toLowerCase()).filter(p => p);
        let matchCount = 0;
        const matchedPatterns = [];
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
    }
    else {
        console.log('  ❌ [MATCH_REPO] No match found');
        console.log('  Available repositories:', repositories.map(r => ({ name: r.name, patterns: r.servicePatterns })));
    }
    return bestMatch;
}
function createCodeRepository(repo) {
    const database = getDb();
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const encryptedToken = repo.gitLabToken ? encryptPassword(repo.gitLabToken) : null;
    database.run(`INSERT INTO code_repositories (id, projectId, name, repositoryUrl, servicePatterns, gitLabToken, defaultBranch, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, repo.projectId, repo.name, repo.repositoryUrl, repo.servicePatterns, encryptedToken, repo.defaultBranch || 'main', now, now]);
    saveDatabase();
    return {
        ...repo,
        id,
        createdAt: now,
        updatedAt: now,
    };
}
function updateCodeRepository(id, updates) {
    const database = getDb();
    const existing = getCodeRepositoryById(id);
    if (!existing)
        return undefined;
    const now = new Date().toISOString();
    const updated = { ...existing, ...updates, updatedAt: now };
    const encryptedToken = updated.gitLabToken ? encryptPassword(updated.gitLabToken) : null;
    database.run(`UPDATE code_repositories SET name = ?, repositoryUrl = ?, servicePatterns = ?, gitLabToken = ?, defaultBranch = ?, updatedAt = ? WHERE id = ?`, [
        updated.name,
        updated.repositoryUrl,
        updated.servicePatterns,
        encryptedToken,
        updated.defaultBranch || 'main',
        now,
        id,
    ]);
    saveDatabase();
    return updated;
}
function deleteCodeRepository(id) {
    const database = getDb();
    database.run('DELETE FROM code_repositories WHERE id = ?', [id]);
    saveDatabase();
}
function createDefaultCodeRepositories(projectId) {
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
            }
            catch (e) {
                console.error('Failed to create default repo:', repo.name, e);
            }
        }
    }
}
function inferBranchFromTag(tag) {
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
function getGlobalConfig() {
    const database = getDb();
    const result = database.exec('SELECT * FROM global_config LIMIT 1');
    if (result.length === 0 || result[0].values.length === 0) {
        return undefined;
    }
    const row = result[0].values[0];
    return {
        id: row[0],
        deepseekApiKey: row[1] ? decryptPassword(row[1]) : undefined,
        deepseekBaseUrl: row[2],
        deepseekModel: row[3],
        createdAt: row[4],
        updatedAt: row[5],
    };
}
function createOrUpdateGlobalConfig(config) {
    const database = getDb();
    const now = new Date().toISOString();
    try {
        const existing = getGlobalConfig();
        if (existing) {
            const encryptedApiKey = config.deepseekApiKey ? encryptPassword(config.deepseekApiKey) : null;
            database.run(`UPDATE global_config SET deepseekApiKey = ?, deepseekBaseUrl = ?, deepseekModel = ?, updatedAt = ? WHERE id = ?`, [encryptedApiKey, config.deepseekBaseUrl || null, config.deepseekModel || null, now, existing.id]);
            saveDatabase();
            return {
                ...existing,
                ...config,
                updatedAt: now,
            };
        }
        else {
            const id = (0, uuid_1.v4)();
            const encryptedApiKey = config.deepseekApiKey ? encryptPassword(config.deepseekApiKey) : null;
            database.run(`INSERT INTO global_config (id, deepseekApiKey, deepseekBaseUrl, deepseekModel, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`, [id, encryptedApiKey, config.deepseekBaseUrl || null, config.deepseekModel || null, now, now]);
            saveDatabase();
            return {
                id,
                ...config,
                createdAt: now,
                updatedAt: now,
            };
        }
    }
    catch (error) {
        console.error('Error creating or updating global config:', error);
        throw error;
    }
}
