"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    getDataSources: () => electron_1.ipcRenderer.invoke('db:getDataSources'),
    createDataSource: (ds) => electron_1.ipcRenderer.invoke('db:createDataSource', ds),
    updateDataSource: (id, ds) => electron_1.ipcRenderer.invoke('db:updateDataSource', id, ds),
    deleteDataSource: (id) => electron_1.ipcRenderer.invoke('db:deleteDataSource', id),
    setActiveDataSource: (id) => electron_1.ipcRenderer.invoke('db:setActiveDataSource', id),
    getActiveDataSource: () => electron_1.ipcRenderer.invoke('db:getActiveDataSource'),
    testConnection: (ds) => electron_1.ipcRenderer.invoke('db:testConnection', ds),
    getQueryHistory: () => electron_1.ipcRenderer.invoke('db:getQueryHistory'),
    clearQueryHistory: () => electron_1.ipcRenderer.invoke('db:clearQueryHistory'),
    getSchema: (dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false) => electron_1.ipcRenderer.invoke('db:getSchema', dataSourceId, ownerFilter, tableNamePattern, useCache, filterEmptyTables),
    getSchemaFromCache: (dataSourceId) => electron_1.ipcRenderer.invoke('db:getSchemaFromCache', dataSourceId),
    executeQuery: (dataSourceId, sql) => electron_1.ipcRenderer.invoke('db:executeQuery', dataSourceId, sql),
    onSchemaProgress: (callback) => {
        const handler = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('schema:progress', handler);
        return () => electron_1.ipcRenderer.removeListener('schema:progress', handler);
    },
    cancelSchemaLoad: () => electron_1.ipcRenderer.invoke('db:cancelSchemaLoad'),
    removeTableFromCache: (dataSourceId, tableName) => electron_1.ipcRenderer.invoke('db:removeTableFromCache', dataSourceId, tableName),
    removeTablesFromCache: (dataSourceId, tableNames) => electron_1.ipcRenderer.invoke('db:removeTablesFromCache', dataSourceId, tableNames),
    startAnalysis: (request) => electron_1.ipcRenderer.invoke('api:startAnalysis', request),
    chatWithAI: (message, projectId) => electron_1.ipcRenderer.invoke('ai:chat', message, projectId),
    setGitLabConfig: (config) => electron_1.ipcRenderer.invoke('ai:setGitLabConfig', config),
    testGetCode: (params) => electron_1.ipcRenderer.invoke('ai:testGetCode', params),
    onAIStream: (callback) => {
        const handler = (_, content) => callback(content);
        electron_1.ipcRenderer.on('ai:stream', handler);
        return () => electron_1.ipcRenderer.removeListener('ai:stream', handler);
    },
    onAnalysisStepUpdate: (callback) => {
        const handler = (_, stepData) => callback(stepData);
        electron_1.ipcRenderer.on('analysis:stepUpdate', handler);
        return () => electron_1.ipcRenderer.removeListener('analysis:stepUpdate', handler);
    },
    onAnalysisStepComplete: (callback) => {
        const handler = (_, stepData) => callback(stepData);
        electron_1.ipcRenderer.on('analysis:stepComplete', handler);
        return () => electron_1.ipcRenderer.removeListener('analysis:stepComplete', handler);
    },
    onAnalysisStepError: (callback) => {
        const handler = (_, stepData) => callback(stepData);
        electron_1.ipcRenderer.on('analysis:stepError', handler);
        return () => electron_1.ipcRenderer.removeListener('analysis:stepError', handler);
    },
    onAnalysisStreamChunk: (callback) => {
        const handler = (_, content) => callback(content);
        electron_1.ipcRenderer.on('analysis:streamChunk', handler);
        return () => electron_1.ipcRenderer.removeListener('analysis:streamChunk', handler);
    },
    testRedisConnection: (config) => electron_1.ipcRenderer.invoke('redis:testConnection', config),
    getRedisTokens: (config, prefix) => electron_1.ipcRenderer.invoke('redis:getTokens', config, prefix),
    getRedisFirstToken: (config, prefix) => electron_1.ipcRenderer.invoke('redis:getFirstToken', config, prefix),
    getModuleVersions: (config) => electron_1.ipcRenderer.invoke('api:getModuleVersions', config),
    getLogs: (config) => electron_1.ipcRenderer.invoke('api:getLogs', config),
    getCodeRepositories: (projectId) => electron_1.ipcRenderer.invoke('db:getCodeRepositories', projectId),
    getCodeRepositoryById: (id) => electron_1.ipcRenderer.invoke('db:getCodeRepositoryById', id),
    createCodeRepository: (repo) => electron_1.ipcRenderer.invoke('db:createCodeRepository', repo),
    updateCodeRepository: (id, updates) => electron_1.ipcRenderer.invoke('db:updateCodeRepository', id, updates),
    deleteCodeRepository: (id) => electron_1.ipcRenderer.invoke('db:deleteCodeRepository', id),
    createDefaultCodeRepositories: (projectId) => electron_1.ipcRenderer.invoke('db:createDefaultCodeRepositories', projectId),
    matchCodeRepository: (projectId, serviceName, requestUrl) => electron_1.ipcRenderer.invoke('db:matchCodeRepository', projectId, serviceName, requestUrl),
    inferBranchFromTag: (tag) => electron_1.ipcRenderer.invoke('db:inferBranchFromTag', tag),
    getGlobalConfig: () => electron_1.ipcRenderer.invoke('db:getGlobalConfig'),
    saveGlobalConfig: (config) => electron_1.ipcRenderer.invoke('db:saveGlobalConfig', config),
    project: {
        getAll: () => electron_1.ipcRenderer.invoke('project:getAll'),
        getById: (id) => electron_1.ipcRenderer.invoke('project:getById', id),
        create: (project) => electron_1.ipcRenderer.invoke('project:create', project),
        update: (id, project) => electron_1.ipcRenderer.invoke('project:update', id, project),
        delete: (id) => electron_1.ipcRenderer.invoke('project:delete', id),
        setActive: (id) => electron_1.ipcRenderer.invoke('project:setActive', id),
        getActive: () => electron_1.ipcRenderer.invoke('project:getActive'),
        getActiveWithDetails: () => electron_1.ipcRenderer.invoke('project:getActiveWithDetails'),
        getDataSource: (projectId) => electron_1.ipcRenderer.invoke('project:getDataSource', projectId),
        createDataSource: (ds) => electron_1.ipcRenderer.invoke('project:createDataSource', ds),
        updateDataSource: (id, ds) => electron_1.ipcRenderer.invoke('project:updateDataSource', id, ds),
        deleteDataSource: (id) => electron_1.ipcRenderer.invoke('project:deleteDataSource', id),
        getConfig: (projectId) => electron_1.ipcRenderer.invoke('project:getConfig', projectId),
        saveConfig: (config) => electron_1.ipcRenderer.invoke('project:saveConfig', config),
        testDataSourceConnection: (ds) => electron_1.ipcRenderer.invoke('project:testDataSourceConnection', ds),
        executeQuery: (dataSourceId, sql) => electron_1.ipcRenderer.invoke('project:executeQuery', dataSourceId, sql),
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
