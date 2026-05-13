"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const agent_1 = require("../agent");
const sqlite_1 = require("../database/sqlite");
const oracle_1 = require("../database/oracle");
const dameng_1 = require("../database/dameng");
const redis_1 = require("../redis");
let currentAbortController = null;
function registerIpcHandlers() {
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
                    mainWindow.webContents.send('analysis:stepUpdate', { stepId, status: 'loading' });
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
            await agent.runStepByStep(request, callback);
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
            return (0, sqlite_1.createOrUpdateGlobalConfig)(config);
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
    electron_1.ipcMain.handle('db:getSchema', async (_event, dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false) => {
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
            if (dataSource.type === 'oracle') {
                tables = await (0, oracle_1.getOracleTables)({
                    host: dataSource.host,
                    port: dataSource.port,
                    serviceName: dataSource.serviceName,
                    sid: dataSource.sid,
                    username: dataSource.username,
                    password: dataSource.password,
                    schema: dataSource.schema,
                }, undefined, ownerFilter, tableNamePattern, abortSignal, filterEmptyTables);
            }
            else if (dataSource.type === 'dameng') {
                tables = await (0, dameng_1.getDamengTables)({
                    host: dataSource.host,
                    port: dataSource.port,
                    schema: dataSource.schema || dataSource.username,
                    username: dataSource.username,
                    password: dataSource.password,
                }, undefined, tableNamePattern, abortSignal, filterEmptyTables);
            }
            (0, sqlite_1.setSchemaCache)(dataSourceId, tables, undefined);
            return tables;
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
            return await (0, redis_1.getFirstTokenFromRedis)({
                host: config.host,
                port: config.port,
                password: config.password,
                db: config.db || 0,
            }, prefix);
        }
        catch (error) {
            console.error('Error getting first Redis token:', error);
            throw error;
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
}
