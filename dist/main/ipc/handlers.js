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
    electron_1.ipcMain.handle('db:getSchema', async (_, dataSourceId) => {
        try {
            console.log('Getting schema for data source:', dataSourceId);
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
                const tables = await (0, oracle_1.getOracleTables)(params);
                console.log(`Got ${tables.length} tables for Oracle`);
                return tables;
            }
            else if (ds.type === 'dameng') {
                const params = {
                    host: ds.host,
                    port: ds.port,
                    schema: ds.schema || ds.username,
                    username: ds.username,
                    password: ds.password,
                };
                const tables = await (0, dameng_1.getDamengTables)(params);
                console.log(`Got ${tables.length} tables for Dameng`);
                return tables;
            }
            throw new Error('不支持的数据库类型');
        }
        catch (error) {
            console.error('Error getting schema:', error);
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
