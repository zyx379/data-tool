"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const sqlite_1 = require("../database/sqlite");
const oracle_1 = require("../database/oracle");
const dameng_1 = require("../database/dameng");
let schemaAbortController = null;
function registerIpcHandlers() {
    electron_1.ipcMain.handle('db:getDataSources', async () => {
        try {
            return (0, sqlite_1.getAllDataSources)();
        }
        catch (error) {
            console.error('Error getting data sources:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getDataSourceById', async (_, id) => {
        try {
            return (0, sqlite_1.getDataSourceById)(id);
        }
        catch (error) {
            console.error('Error getting data source by id:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:createDataSource', async (_, ds) => {
        try {
            console.log('Creating data source:', ds);
            const result = (0, sqlite_1.createDataSource)(ds);
            console.log('Data source created:', result);
            return result;
        }
        catch (error) {
            console.error('Error creating data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:updateDataSource', async (_, id, ds) => {
        try {
            console.log('Updating data source:', id, ds);
            const result = (0, sqlite_1.updateDataSource)(id, ds);
            console.log('Data source updated:', result);
            return result;
        }
        catch (error) {
            console.error('Error updating data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:deleteDataSource', async (_, id) => {
        try {
            console.log('Deleting data source:', id);
            (0, sqlite_1.deleteDataSource)(id);
            console.log('Data source deleted');
        }
        catch (error) {
            console.error('Error deleting data source:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:setActiveDataSource', async (_, id) => {
        try {
            console.log('Setting active data source:', id);
            (0, sqlite_1.setActiveDataSource)(id);
            console.log('Active data source set');
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
    electron_1.ipcMain.handle('db:testConnection', async (_, ds) => {
        try {
            console.log('Testing connection:', ds);
            if (ds.type === 'oracle') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    serviceName: ds.serviceName,
                    sid: ds.sid,
                    username: ds.username,
                    password: ds.password,
                    schema: ds.schema,
                };
                const result = await testOracleConnection(params);
                return result;
            }
            else if (ds.type === 'dameng') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                };
                const result = await testDamengConnection(params);
                return result;
            }
            return { success: false, message: '不支持的数据库类型' };
        }
        catch (error) {
            console.error('Connection test failed:', error);
            return { success: false, message: error.message };
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
    electron_1.ipcMain.handle('db:addQueryHistory', async (_, history) => {
        try {
            (0, sqlite_1.addQueryHistory)(history);
        }
        catch (error) {
            console.error('Error adding query history:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:clearQueryHistory', async () => {
        try {
            (0, sqlite_1.clearQueryHistory)();
        }
        catch (error) {
            console.error('Error clearing query history:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:getSchema', async (event, dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false) => {
        try {
            console.log('=== db:getSchema called ===');
            console.log('dataSourceId:', dataSourceId);
            console.log('ownerFilter (received):', ownerFilter);
            console.log('tableNamePattern (received):', tableNamePattern);
            console.log('useCache:', useCache);
            console.log('filterEmptyTables:', filterEmptyTables);
            const ds = (0, sqlite_1.getDataSourceById)(dataSourceId);
            if (!ds) {
                throw new Error('数据源不存在');
            }
            console.log('DataSource type:', ds.type);
            console.log('DataSource schema:', ds.schema);
            const cacheKey = `${ownerFilter || ''}:${tableNamePattern || ''}:${filterEmptyTables ? 'filterEmpty' : ''}`;
            if (useCache) {
                const cached = (0, sqlite_1.getSchemaCache)(dataSourceId, cacheKey);
                if (cached) {
                    const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
                    const cacheAgeHours = cacheAgeMs / (1000 * 60 * 60);
                    if (cacheAgeHours < 24) {
                        console.log(`Using cached schema (age: ${cacheAgeHours.toFixed(2)} hours)`);
                        return cached.schemaData;
                    }
                    else {
                        console.log(`Cache expired (age: ${cacheAgeHours.toFixed(2)} hours), fetching fresh`);
                    }
                }
                else {
                    console.log('No cached schema found');
                }
            }
            schemaAbortController = new AbortController();
            const abortSignal = schemaAbortController.signal;
            const sendProgress = (progress) => {
                event.sender.send('schema:progress', progress);
            };
            let tables;
            if (ds.type === 'oracle') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    serviceName: ds.serviceName,
                    sid: ds.sid,
                    username: ds.username,
                    password: ds.password,
                    schema: ds.schema,
                };
                console.log('Calling getOracleTables with params:', { ownerFilter, tableNamePattern, filterEmptyTables });
                tables = await (0, oracle_1.getOracleTables)(params, sendProgress, ownerFilter, tableNamePattern, abortSignal, filterEmptyTables);
                console.log(`Got ${tables.length} tables for Oracle`);
            }
            else if (ds.type === 'dameng') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                };
                console.log('Calling getDamengTables with tableNamePattern:', tableNamePattern);
                tables = await (0, dameng_1.getDamengTables)(params, sendProgress, tableNamePattern, abortSignal, filterEmptyTables);
                console.log(`Got ${tables.length} tables for Dameng`);
            }
            else {
                throw new Error('不支持的数据库类型');
            }
            if (useCache && tables.length > 0) {
                console.log('Caching schema...');
                (0, sqlite_1.setSchemaCache)(dataSourceId, tables, cacheKey);
                (0, sqlite_1.cleanOldSchemaCache)(7);
            }
            return tables;
        }
        catch (error) {
            console.error('Error getting schema:', error);
            throw error;
        }
        finally {
            schemaAbortController = null;
        }
    });
    electron_1.ipcMain.handle('db:getSchemaFromCache', async (_, dataSourceId) => {
        try {
            console.log('=== db:getSchemaFromCache called ===');
            console.log('dataSourceId:', dataSourceId);
            const cache = (0, sqlite_1.getSchemaCache)(dataSourceId, undefined, true);
            if (cache) {
                console.log('Found cached schema');
                return cache.schemaData;
            }
            else {
                console.log('No cached schema found');
                return [];
            }
        }
        catch (error) {
            console.error('Error getting schema from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:cancelSchemaLoad', async () => {
        try {
            console.log('=== db:cancelSchemaLoad called ===');
            if (schemaAbortController) {
                schemaAbortController.abort();
                schemaAbortController = null;
                console.log('Schema load cancelled');
            }
            else {
                console.log('No schema load in progress');
            }
        }
        catch (error) {
            console.error('Error cancelling schema load:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:removeTableFromCache', async (_, dataSourceId, tableName) => {
        try {
            console.log('Removing table from cache:', dataSourceId, tableName);
            (0, sqlite_1.removeTableFromSchemaCache)(dataSourceId, tableName);
            console.log('Table removed from cache');
        }
        catch (error) {
            console.error('Error removing table from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:removeTablesFromCache', async (_, dataSourceId, tableNames) => {
        try {
            console.log('Removing tables from cache:', dataSourceId, tableNames);
            (0, sqlite_1.removeTablesFromSchemaCache)(dataSourceId, tableNames);
            console.log('Tables removed from cache');
        }
        catch (error) {
            console.error('Error removing tables from cache:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('db:executeQuery', async (_, dataSourceId, sql) => {
        try {
            console.log('Executing query on data source:', dataSourceId, sql);
            const ds = (0, sqlite_1.getDataSourceById)(dataSourceId);
            if (!ds) {
                throw new Error('数据源不存在');
            }
            if (ds.type === 'oracle') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    serviceName: ds.serviceName,
                    sid: ds.sid,
                    username: ds.username,
                    password: ds.password,
                    schema: ds.schema,
                };
                const result = await (0, oracle_1.executeOracleQuery)(params, sql);
                (0, sqlite_1.addQueryHistory)({
                    sql,
                    executedAt: new Date().toISOString(),
                    executionTime: result.executionTime,
                    rowCount: result.rowCount,
                    dataSourceId: ds.id,
                    dataSourceName: ds.name,
                });
                return result;
            }
            else if (ds.type === 'dameng') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                };
                const result = await (0, dameng_1.executeDamengQuery)(params, sql);
                (0, sqlite_1.addQueryHistory)({
                    sql,
                    executedAt: new Date().toISOString(),
                    executionTime: result.executionTime,
                    rowCount: result.rowCount,
                    dataSourceId: ds.id,
                    dataSourceName: ds.name,
                });
                return result;
            }
            throw new Error('不支持的数据库类型');
        }
        catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    });
    console.log('All IPC handlers registered');
}
async function testOracleConnection(params) {
    const oracle = await Promise.resolve().then(() => __importStar(require('../database/oracle')));
    return oracle.testOracleConnection(params);
}
async function testDamengConnection(params) {
    const dameng = await Promise.resolve().then(() => __importStar(require('../database/dameng')));
    return dameng.testDamengConnection(params);
}
