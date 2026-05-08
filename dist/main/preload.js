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
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
