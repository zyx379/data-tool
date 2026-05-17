"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const schemaMerge_1 = require("../database/schemaMerge");
const agent_1 = require("../agent");
const sqlite_1 = require("../database/sqlite");
const oracle_1 = require("../database/oracle");
const dameng_1 = require("../database/dameng");
const redis_1 = require("../redis");
const gitLab_1 = require("../agent/tools/gitLab");
const report_1 = require("../report");
const reportStorage_1 = require("../database/reportStorage");
let currentAbortController = null;
const chatSessions = new Map();
function registerIpcHandlers() {
    // 启动时从全局配置初始化 GitLab 配置
    try {
        const globalConfig = (0, sqlite_1.getGlobalConfig)();
        if (globalConfig) {
            (0, gitLab_1.updateGitLabConfig)({
                baseUrl: globalConfig.gitLabBaseUrl,
                token: globalConfig.gitLabToken,
            });
        }
    }
    catch (e) {
        console.error('Failed to initialize GitLab config from global config:', e);
    }
    electron_1.ipcMain.handle('api:startAnalysis', async (_event, request) => {
        try {
            const agent = (0, agent_1.createAgent)();
            const mainWindow = electron_1.BrowserWindow.getAllWindows()[0];
            if (!mainWindow) {
                throw new Error('未找到主窗口');
            }
            const steps = [];
            const callback = {
                onStepStart: (stepId) => {
                    console.log(`[IPC] Step started: ${stepId}`);
                    const step = steps.find(s => s.id === stepId);
                    if (step) {
                        step.status = 'loading';
                    }
                    mainWindow.webContents.send('analysis:stepUpdate', { id: stepId, status: 'loading' });
                },
                onStepUpdate: (stepData) => {
                    const existingIndex = steps.findIndex(s => s.id === stepData.id);
                    if (existingIndex >= 0) {
                        steps[existingIndex] = stepData;
                    }
                    else {
                        steps.push(stepData);
                    }
                    mainWindow.webContents.send('analysis:stepUpdate', stepData);
                },
                onStepComplete: (stepData) => {
                    const existingIndex = steps.findIndex(s => s.id === stepData.id);
                    if (existingIndex >= 0) {
                        steps[existingIndex] = stepData;
                    }
                    else {
                        steps.push(stepData);
                    }
                    mainWindow.webContents.send('analysis:stepComplete', stepData);
                },
                onStepError: (stepId, error) => {
                    console.error(`[IPC] Step error: ${stepId} - ${error}`);
                    const step = steps.find(s => s.id === stepId);
                    const stepData = {
                        id: stepId,
                        status: 'error',
                        title: step?.title || '',
                        content: '',
                        error,
                        timestamp: new Date().toISOString(),
                    };
                    const existingIndex = steps.findIndex(s => s.id === stepId);
                    if (existingIndex >= 0) {
                        steps[existingIndex] = stepData;
                    }
                    else {
                        steps.push(stepData);
                    }
                    mainWindow.webContents.send('analysis:stepError', stepData);
                },
                onStreamChunk: (content) => {
                    mainWindow.webContents.send('analysis:streamChunk', content);
                },
            };
            const conversation = await agent.runStepByStep(request, callback);
            chatSessions.set(request.projectId, new agent_1.ChatSession(conversation, {
                projectId: request.projectId,
                apiBaseUrl: request.apiBaseUrl,
                apiToken: request.apiToken,
                apiLogPath: request.apiLogPath,
                apiTokenPath: request.apiTokenPath,
                apiVersionPath: request.apiVersionPath,
                logId: request.logId,
            }));
            return {
                success: true,
                steps,
            };
        }
        catch (error) {
            console.error('Analysis error:', error);
            return {
                success: false,
                message: error.message || '分析过程发生错误',
                steps: [],
            };
        }
    });
    electron_1.ipcMain.handle('db:getGlobalConfig', async () => {
        try {
            return (0, sqlite_1.getGlobalConfig)();
        }
        catch (error) {
            console.error('Error getting global config:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:saveGlobalConfig', async (_event, config) => {
        try {
            const result = (0, sqlite_1.createOrUpdateGlobalConfig)(config);
            // 同步更新内存中的 GitLab 配置
            (0, gitLab_1.updateGitLabConfig)({
                baseUrl: config.gitLabBaseUrl,
                token: config.gitLabToken,
            });
            return result;
        }
        catch (error) {
            console.error('Error saving global config:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getCodeRepositories', async (_event, projectId) => {
        try {
            return (0, sqlite_1.getCodeRepositoriesByProjectId)(projectId);
        }
        catch (error) {
            console.error('Error getting code repositories:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getSchemaFromCache', async (_event, dataSourceId) => {
        try {
            const cache = (0, sqlite_1.getSchemaCache)(dataSourceId);
            return cache?.schemaData || [];
        }
        catch (error) {
            console.error('Error getting schema from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getSchema', async (_event, dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false, mergeWithExistingCache = false, filterNoCommentTables = true) => {
        try {
            if (currentAbortController) {
                currentAbortController.abort();
            }
            currentAbortController = new AbortController();
            const dataSource = (0, sqlite_1.getDataSourceById)(dataSourceId);
            if (!dataSource) {
                throw new Error('数据源不存在');
            }
            if (useCache) {
                const cache = (0, sqlite_1.getSchemaCache)(dataSourceId, undefined, true);
                if (cache && cache.schemaData && cache.schemaData.length > 0) {
                    return cache.schemaData;
                }
            }
            let tables = [];
            const abortSignal = currentAbortController.signal;
            const progressWindow = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
            const onSchemaProgress = (progress) => {
                progressWindow?.webContents.send('schema:progress', progress);
            };
            if (dataSource.type === 'oracle') {
                tables = await (0, oracle_1.getOracleTables)({
                    host: dataSource.host,
                    port: dataSource.port,
                    serviceName: dataSource.serviceName,
                    sid: dataSource.sid,
                    username: dataSource.username,
                    password: dataSource.password,
                    schema: dataSource.schema,
                }, onSchemaProgress, ownerFilter, tableNamePattern, abortSignal, filterEmptyTables, filterNoCommentTables);
            }
            else if (dataSource.type === 'dameng') {
                tables = await (0, dameng_1.getDamengTables)({
                    host: dataSource.host,
                    port: dataSource.port,
                    schema: dataSource.schema || dataSource.username,
                    username: dataSource.username,
                    password: dataSource.password,
                }, onSchemaProgress, tableNamePattern, abortSignal, filterEmptyTables, filterNoCommentTables);
            }
            let tablesToSave = tables;
            if (mergeWithExistingCache) {
                const existing = (0, sqlite_1.getSchemaCache)(dataSourceId, undefined, true);
                const base = existing?.schemaData && Array.isArray(existing.schemaData) ? existing.schemaData : [];
                tablesToSave = (0, schemaMerge_1.mergeSchemaIncremental)(base, tables);
                console.log('[db:getSchema] mergeWithExistingCache: base', base.length, '+ fetched', tables.length, '=>', tablesToSave.length);
            }
            (0, sqlite_1.setSchemaCache)(dataSourceId, tablesToSave, undefined);
            return tablesToSave;
        }
        catch (error) {
            if (error.message === 'Operation cancelled') {
                return [];
            }
            console.error('Error getting schema:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:cancelSchemaLoad', async () => {
        try {
            if (currentAbortController) {
                currentAbortController.abort();
                currentAbortController = null;
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error cancelling schema load:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:executeQuery', async (_event, dataSourceId, sql) => {
        try {
            const dataSource = (0, sqlite_1.getDataSourceById)(dataSourceId);
            if (!dataSource) {
                throw new Error('数据源不存在');
            }
            let result;
            const startTime = Date.now();
            if (dataSource.type === 'oracle') {
                result = await (0, oracle_1.executeOracleQuery)({
                    host: dataSource.host,
                    port: dataSource.port,
                    serviceName: dataSource.serviceName,
                    sid: dataSource.sid,
                    username: dataSource.username,
                    password: dataSource.password,
                }, sql);
            }
            else if (dataSource.type === 'dameng') {
                result = await (0, dameng_1.executeDamengQuery)({
                    host: dataSource.host,
                    port: dataSource.port,
                    schema: dataSource.schema || dataSource.username,
                    username: dataSource.username,
                    password: dataSource.password,
                }, sql);
            }
            (0, sqlite_1.addQueryHistory)({
                sql,
                executedAt: new Date().toISOString(),
                executionTime: Date.now() - startTime,
                rowCount: result.rowCount,
                dataSourceId,
                dataSourceName: dataSource.name,
            });
            return result;
        }
        catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:testConnection', async (_event, ds) => {
        try {
            if (ds.type === 'oracle') {
                return await (0, oracle_1.testOracleConnection)({
                    host: ds.host,
                    port: ds.port,
                    serviceName: ds.serviceName,
                    sid: ds.sid,
                    username: ds.username,
                    password: ds.password,
                    schema: ds.schema,
                });
            }
            else if (ds.type === 'dameng') {
                return await (0, dameng_1.testDamengConnection)({
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                });
            }
            throw new Error('不支持的数据库类型');
        }
        catch (error) {
            console.error('Error testing connection:', error);
            return { success: false, message: error.message };
        }
    });
    electron_1.ipcMain.handle('db:getDataSources', async () => {
        try {
            return (0, sqlite_1.getAllDataSources)();
        }
        catch (error) {
            console.error('Error getting data sources:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:createDataSource', async (_event, ds) => {
        try {
            return (0, sqlite_1.createDataSource)(ds);
        }
        catch (error) {
            console.error('Error creating data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:updateDataSource', async (_event, id, ds) => {
        try {
            return (0, sqlite_1.updateDataSource)(id, ds);
        }
        catch (error) {
            console.error('Error updating data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:deleteDataSource', async (_event, id) => {
        try {
            return (0, sqlite_1.deleteDataSource)(id);
        }
        catch (error) {
            console.error('Error deleting data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:setActiveDataSource', async (_event, id) => {
        try {
            const dataSource = (0, sqlite_1.getDataSourceById)(id);
            if (dataSource) {
                (0, sqlite_1.setActiveProject)(dataSource.projectId);
            }
            return { success: true };
        }
        catch (error) {
            console.error('Error setting active data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getActiveDataSource', async () => {
        try {
            return (0, sqlite_1.getActiveDataSource)();
        }
        catch (error) {
            console.error('Error getting active data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getQueryHistory', async () => {
        try {
            return (0, sqlite_1.getQueryHistory)();
        }
        catch (error) {
            console.error('Error getting query history:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:clearQueryHistory', async () => {
        try {
            return (0, sqlite_1.clearQueryHistory)();
        }
        catch (error) {
            console.error('Error clearing query history:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:removeTableFromCache', async (_event, dataSourceId, tableName) => {
        try {
            return (0, sqlite_1.removeTableFromSchemaCache)(dataSourceId, tableName);
        }
        catch (error) {
            console.error('Error removing table from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:removeTablesFromCache', async (_event, dataSourceId, tableNames) => {
        try {
            return (0, sqlite_1.removeTablesFromSchemaCache)(dataSourceId, tableNames);
        }
        catch (error) {
            console.error('Error removing tables from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getCodeRepositoryById', async (_event, id) => {
        try {
            return (0, sqlite_1.getCodeRepositoryById)(id);
        }
        catch (error) {
            console.error('Error getting code repository by id:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:createCodeRepository', async (_event, repo) => {
        try {
            return (0, sqlite_1.createCodeRepository)(repo);
        }
        catch (error) {
            console.error('Error creating code repository:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:updateCodeRepository', async (_event, id, updates) => {
        try {
            return (0, sqlite_1.updateCodeRepository)(id, updates);
        }
        catch (error) {
            console.error('Error updating code repository:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:deleteCodeRepository', async (_event, id) => {
        try {
            return (0, sqlite_1.deleteCodeRepository)(id);
        }
        catch (error) {
            console.error('Error deleting code repository:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:createDefaultCodeRepositories', async (_event, projectId) => {
        try {
            return (0, sqlite_1.createDefaultCodeRepositories)(projectId);
        }
        catch (error) {
            console.error('Error creating default code repositories:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:matchCodeRepository', async (_event, projectId, serviceName, requestUrl) => {
        try {
            return (0, sqlite_1.matchCodeRepository)(projectId, serviceName, requestUrl);
        }
        catch (error) {
            console.error('Error matching code repository:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:inferBranchFromTag', async (_event, tag) => {
        try {
            return (0, sqlite_1.inferBranchFromTag)(tag);
        }
        catch (error) {
            console.error('Error inferring branch from tag:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getAll', async () => {
        try {
            return (0, sqlite_1.getAllProjects)();
        }
        catch (error) {
            console.error('Error getting all projects:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getById', async (_event, id) => {
        try {
            return (0, sqlite_1.getProjectById)(id);
        }
        catch (error) {
            console.error('Error getting project by id:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:create', async (_event, project) => {
        try {
            return (0, sqlite_1.createProject)(project);
        }
        catch (error) {
            console.error('Error creating project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:update', async (_event, id, project) => {
        try {
            return (0, sqlite_1.updateProject)(id, project);
        }
        catch (error) {
            console.error('Error updating project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:delete', async (_event, id) => {
        try {
            return (0, sqlite_1.deleteProject)(id);
        }
        catch (error) {
            console.error('Error deleting project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:setActive', async (_event, id) => {
        try {
            return (0, sqlite_1.setActiveProject)(id);
        }
        catch (error) {
            console.error('Error setting active project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getActive', async () => {
        try {
            const project = (0, sqlite_1.getProjectById)('');
            const projects = (0, sqlite_1.getAllProjects)();
            return projects.find(p => p.isActive === 1);
        }
        catch (error) {
            console.error('Error getting active project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getActiveWithDetails', async () => {
        try {
            return (0, sqlite_1.getActiveProjectWithDetails)();
        }
        catch (error) {
            console.error('Error getting active project with details:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getDataSource', async (_event, projectId) => {
        try {
            return (0, sqlite_1.getProjectDataSourceById)(projectId);
        }
        catch (error) {
            console.error('Error getting project data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:createDataSource', async (_event, ds) => {
        try {
            return (0, sqlite_1.createProjectDataSource)(ds);
        }
        catch (error) {
            console.error('Error creating project data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:updateDataSource', async (_event, id, ds) => {
        try {
            return (0, sqlite_1.updateProjectDataSource)(id, ds);
        }
        catch (error) {
            console.error('Error updating project data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:deleteDataSource', async (_event, id) => {
        try {
            return (0, sqlite_1.deleteProjectDataSource)(id);
        }
        catch (error) {
            console.error('Error deleting project data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:getConfig', async (_event, projectId) => {
        try {
            return (0, sqlite_1.getProjectConfig)(projectId);
        }
        catch (error) {
            console.error('Error getting project config:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:saveConfig', async (_event, config) => {
        try {
            return (0, sqlite_1.createOrUpdateProjectConfig)(config);
        }
        catch (error) {
            console.error('Error saving project config:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:testDataSourceConnection', async (_event, ds) => {
        try {
            if (ds.type === 'oracle') {
                return await (0, oracle_1.testOracleConnection)({
                    host: ds.host,
                    port: ds.port,
                    serviceName: ds.serviceName,
                    sid: ds.sid,
                    username: ds.username,
                    password: ds.password,
                    schema: ds.schema,
                });
            }
            else if (ds.type === 'dameng') {
                return await (0, dameng_1.testDamengConnection)({
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                });
            }
            throw new Error('不支持的数据库类型');
        }
        catch (error) {
            console.error('Error testing data source connection:', error);
            return { success: false, message: error.message };
        }
    });
    electron_1.ipcMain.handle('project:executeQuery', async (_event, dataSourceId, sql) => {
        try {
            const dataSource = (0, sqlite_1.getProjectDataSourceById)(dataSourceId);
            if (!dataSource) {
                throw new Error('数据源不存在');
            }
            let result;
            const startTime = Date.now();
            if (dataSource.type === 'oracle') {
                result = await (0, oracle_1.executeOracleQuery)({
                    host: dataSource.host,
                    port: dataSource.port,
                    serviceName: dataSource.serviceName,
                    sid: dataSource.sid,
                    username: dataSource.username,
                    password: dataSource.password,
                }, sql);
            }
            else if (dataSource.type === 'dameng') {
                result = await (0, dameng_1.executeDamengQuery)({
                    host: dataSource.host,
                    port: dataSource.port,
                    schema: dataSource.schema || dataSource.username,
                    username: dataSource.username,
                    password: dataSource.password,
                }, sql);
            }
            (0, sqlite_1.addQueryHistory)({
                sql,
                executedAt: new Date().toISOString(),
                executionTime: Date.now() - startTime,
                rowCount: result.rowCount,
                dataSourceId,
                dataSourceName: dataSource.name,
            });
            return result;
        }
        catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('ai:chat', async (_event, message, projectId) => {
        try {
            return { success: false, message: 'AI chat not implemented in direct IPC' };
        }
        catch (error) {
            console.error('Error in AI chat:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('ai:setGitLabConfig', async (_event, config) => {
        try {
            (0, gitLab_1.updateGitLabConfig)(config);
            return { success: true };
        }
        catch (error) {
            console.error('Error setting GitLab config:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('ai:testGetCode', async (_event, params) => {
        try {
            return { success: false, message: 'testGetCode not implemented' };
        }
        catch (error) {
            console.error('Error testing get code:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('redis:testConnection', async (_event, config) => {
        try {
            return await (0, redis_1.testRedisConnection)({
                host: config.host,
                port: config.port,
                password: config.password,
                db: config.db || 0,
            });
        }
        catch (error) {
            console.error('Error testing Redis connection:', error);
            return { success: false, message: error.message };
        }
    });
    electron_1.ipcMain.handle('redis:getTokens', async (_event, config, prefix) => {
        try {
            return await (0, redis_1.getTokensFromRedis)({
                host: config.host,
                port: config.port,
                password: config.password,
                db: config.db || 0,
            }, prefix);
        }
        catch (error) {
            console.error('Error getting Redis tokens:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('redis:getFirstToken', async (_event, config, prefix) => {
        try {
            const token = await (0, redis_1.getFirstTokenFromRedis)({
                host: config.host,
                port: config.port,
                password: config.password,
                db: config.db || 0,
            }, prefix);
            if (token) {
                return { success: true, token };
            }
            else {
                return { success: false, token: null, message: '未找到 Token' };
            }
        }
        catch (error) {
            console.error('Error getting first Redis token:', error);
            return { success: false, token: null, message: error.message };
        }
    });
    electron_1.ipcMain.handle('api:getModuleVersions', async (_event, config) => {
        try {
            return { success: false, message: 'getModuleVersions not implemented' };
        }
        catch (error) {
            console.error('Error getting module versions:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('api:getLogs', async (_event, config) => {
        try {
            return { success: false, message: 'getLogs not implemented' };
        }
        catch (error) {
            console.error('Error getting logs:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('chat:sendMessage', async (_event, projectId, message) => {
        try {
            const session = chatSessions.get(projectId);
            if (!session) {
                return { success: false, message: '聊天会话不存在，请先完成分析' };
            }
            const mainWindow = electron_1.BrowserWindow.getAllWindows()[0];
            if (!mainWindow) {
                throw new Error('未找到主窗口');
            }
            const result = await session.sendMessage(message, (chunk) => {
                mainWindow.webContents.send('chat:streamChunk', { projectId, chunk });
            });
            return { success: true, content: result.content };
        }
        catch (error) {
            console.error('Chat error:', error);
            return {
                success: false,
                message: error.message || '对话过程发生错误',
            };
        }
    });
    // ==================== AI 报表 ====================
    electron_1.ipcMain.handle('report:sendMessage', async (_event, params) => {
        try {
            const globalConfig = (0, sqlite_1.getGlobalConfig)();
            if (!globalConfig?.deepseekApiKey) {
                return { success: false, message: '请先在项目管理中配置 DeepSeek API Key' };
            }
            if (params.resetSession) {
                (0, report_1.clearReportSession)(params.sessionKey);
            }
            const session = (0, report_1.getOrCreateReportSession)(params.sessionKey, {
                projectId: params.projectId,
                dataSourceId: params.dataSourceId,
                dbType: params.dbType,
            });
            const mainWindow = electron_1.BrowserWindow.getAllWindows()[0];
            if (!mainWindow) {
                throw new Error('未找到主窗口');
            }
            const result = await session.sendMessage(params.message, (chunk) => {
                mainWindow.webContents.send('report:streamChunk', { sessionKey: params.sessionKey, chunk });
            });
            return {
                success: true,
                content: result.content,
                conversation: session.getConversation(),
            };
        }
        catch (error) {
            console.error('Report chat error:', error);
            return { success: false, message: error.message || '对话失败' };
        }
    });
    electron_1.ipcMain.handle('report:executeQuery', async (_event, params) => {
        try {
            const session = (0, report_1.getOrCreateReportSession)(params.sessionKey, {
                projectId: params.projectId,
                dataSourceId: params.dataSourceId,
                dbType: params.dbType,
            });
            const result = await session.executeSelect(params.sql);
            return { success: true, ...result };
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    });
    electron_1.ipcMain.handle('report:validateSql', async (_event, sql, mode) => {
        const validation = (0, report_1.validateSql)(sql, mode || 'select_only');
        return validation;
    });
    electron_1.ipcMain.handle('report:validateJoin', async (_event, params) => {
        try {
            const session = (0, report_1.getOrCreateReportSession)(params.sessionKey, {
                projectId: params.projectId,
                dataSourceId: params.dataSourceId,
                dbType: params.dbType,
            });
            return await session.validateJoin(params.leftTable, params.leftColumn, params.rightTable, params.rightColumn);
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    });
    electron_1.ipcMain.handle('report:getHistory', async (_event, projectId) => {
        return (0, reportStorage_1.getReportHistory)(projectId);
    });
    electron_1.ipcMain.handle('report:saveHistory', async (_event, record) => {
        return (0, reportStorage_1.saveReportHistory)(record);
    });
    electron_1.ipcMain.handle('report:deleteHistory', async (_event, id) => {
        (0, reportStorage_1.deleteReportHistory)(id);
        return { success: true };
    });
    electron_1.ipcMain.handle('report:clearHistory', async (_event, projectId) => {
        (0, reportStorage_1.clearReportHistory)(projectId);
        return { success: true };
    });
    electron_1.ipcMain.handle('report:getRelationships', async (_event, dataSourceId) => {
        return (0, reportStorage_1.getTableRelationshipsByDs)(dataSourceId);
    });
    electron_1.ipcMain.handle('report:saveRelationship', async (_event, rel) => {
        return (0, reportStorage_1.saveTableRelationship)(rel);
    });
    electron_1.ipcMain.handle('report:deleteRelationship', async (_event, id) => {
        (0, reportStorage_1.deleteTableRelationship)(id);
        return { success: true };
    });
    electron_1.ipcMain.handle('report:clearRelationships', async (_event, dataSourceId) => {
        (0, reportStorage_1.clearTableRelationships)(dataSourceId);
        return { success: true };
    });
    electron_1.ipcMain.handle('report:getTemplates', async (_event, projectId) => {
        return (0, reportStorage_1.getReportTemplates)(projectId);
    });
    electron_1.ipcMain.handle('report:saveTemplate', async (_event, tpl) => {
        return (0, reportStorage_1.saveReportTemplate)(tpl);
    });
    electron_1.ipcMain.handle('report:deleteTemplate', async (_event, id) => {
        (0, reportStorage_1.deleteReportTemplate)(id);
        return { success: true };
    });
    electron_1.ipcMain.handle('report:parseExcel', async (_event, base64, fileName) => {
        try {
            const XLSX = require('xlsx');
            const buffer = Buffer.from(base64, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetNames = workbook.SheetNames;
            const sheets = sheetNames.map((name) => {
                const sheet = workbook.Sheets[name];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const headers = (data[0] || []).map(String);
                const rows = data.slice(1, 6);
                return { name, headers, previewRows: rows, totalRows: Math.max(0, data.length - 1) };
            });
            return { success: true, fileName, sheets };
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    });
}
