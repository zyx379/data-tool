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
    getSchema: (dataSourceId, ownerFilter, tableNamePattern) => electron_1.ipcRenderer.invoke('db:getSchema', dataSourceId, ownerFilter, tableNamePattern),
    executeQuery: (dataSourceId, sql) => electron_1.ipcRenderer.invoke('db:executeQuery', dataSourceId, sql),
    onSchemaProgress: (callback) => {
        const handler = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('schema:progress', handler);
        return () => electron_1.ipcRenderer.removeListener('schema:progress', handler);
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', api);
