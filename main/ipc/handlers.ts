import { ipcMain } from 'electron';
import {
  getAllDataSources,
  getDataSourceById,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  setActiveDataSource,
  getActiveDataSource,
  getQueryHistory,
  addQueryHistory,
  clearQueryHistory,
  getSchemaCache,
  setSchemaCache,
  clearSchemaCache,
  cleanOldSchemaCache,
  removeTableFromSchemaCache,
  removeTablesFromSchemaCache,
  SCHEMA_CACHE_VERSION,
} from '../database/sqlite';
import { getOracleTables, executeOracleQuery, OracleConnectionParams } from '../database/oracle';
import { getDamengTables, executeDamengQuery, DamengConnectionParams } from '../database/dameng';

let schemaAbortController: AbortController | null = null;

export function registerIpcHandlers() {
  ipcMain.handle('db:getDataSources', async () => {
    try {
      return getAllDataSources();
    } catch (error) {
      console.error('Error getting data sources:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getDataSourceById', async (_, id: string) => {
    try {
      return getDataSourceById(id);
    } catch (error) {
      console.error('Error getting data source by id:', error);
      throw error;
    }
  });

  ipcMain.handle('db:createDataSource', async (_, ds: any) => {
    try {
      console.log('Creating data source:', ds);
      const result = createDataSource(ds);
      console.log('Data source created:', result);
      return result;
    } catch (error) {
      console.error('Error creating data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:updateDataSource', async (_, id: string, ds: any) => {
    try {
      console.log('Updating data source:', id, ds);
      const result = updateDataSource(id, ds);
      console.log('Data source updated:', result);
      return result;
    } catch (error) {
      console.error('Error updating data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:deleteDataSource', async (_, id: string) => {
    try {
      console.log('Deleting data source:', id);
      deleteDataSource(id);
      console.log('Data source deleted');
    } catch (error) {
      console.error('Error deleting data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:setActiveDataSource', async (_, id: string) => {
    try {
      console.log('Setting active data source:', id);
      setActiveDataSource(id);
      console.log('Active data source set');
    } catch (error) {
      console.error('Error setting active data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getActiveDataSource', async () => {
    try {
      return getActiveDataSource();
    } catch (error) {
      console.error('Error getting active data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:testConnection', async (_, ds: any) => {
    try {
      console.log('Testing connection:', ds);
      if (ds.type === 'oracle') {
        const params: OracleConnectionParams = {
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
      } else if (ds.type === 'dameng') {
        const params: DamengConnectionParams = {
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
    } catch (error) {
      console.error('Connection test failed:', error);
      return { success: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('db:getQueryHistory', async () => {
    try {
      return getQueryHistory();
    } catch (error) {
      console.error('Error getting query history:', error);
      throw error;
    }
  });

  ipcMain.handle('db:addQueryHistory', async (_, history: any) => {
    try {
      addQueryHistory(history);
    } catch (error) {
      console.error('Error adding query history:', error);
      throw error;
    }
  });

  ipcMain.handle('db:clearQueryHistory', async () => {
    try {
      clearQueryHistory();
    } catch (error) {
      console.error('Error clearing query history:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getSchema', async (event, dataSourceId: string, ownerFilter?: string, tableNamePattern?: string, useCache: boolean = true, filterEmptyTables: boolean = false) => {
    try {
      console.log('=== db:getSchema called ===');
      console.log('dataSourceId:', dataSourceId);
      console.log('ownerFilter (received):', ownerFilter);
      console.log('tableNamePattern (received):', tableNamePattern);
      console.log('useCache:', useCache);
      console.log('filterEmptyTables:', filterEmptyTables);
      
      const ds = getDataSourceById(dataSourceId);
      if (!ds) {
        throw new Error('数据源不存在');
      }
      console.log('DataSource type:', ds.type);
      console.log('DataSource schema:', ds.schema);

      const cacheKey = `${ownerFilter || ''}:${tableNamePattern || ''}:${filterEmptyTables ? 'filterEmpty' : ''}`;
      
      if (useCache) {
        const cached = getSchemaCache(dataSourceId, cacheKey);
        if (cached) {
          const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
          const cacheAgeHours = cacheAgeMs / (1000 * 60 * 60);
          
          if (cacheAgeHours < 24) {
            console.log(`Using cached schema (age: ${cacheAgeHours.toFixed(2)} hours)`);
            return cached.schemaData;
          } else {
            console.log(`Cache expired (age: ${cacheAgeHours.toFixed(2)} hours), fetching fresh`);
          }
        } else {
          console.log('No cached schema found');
        }
      }

      schemaAbortController = new AbortController();
      const abortSignal = schemaAbortController.signal;

      const sendProgress = (progress: any) => {
        event.sender.send('schema:progress', progress);
      };

      let tables: any[];

      if (ds.type === 'oracle') {
        const params: OracleConnectionParams = {
          host: ds.host,
          port: ds.port,
          serviceName: ds.serviceName,
          sid: ds.sid,
          username: ds.username,
          password: ds.password,
          schema: ds.schema,
        };
        console.log('Calling getOracleTables with params:', { ownerFilter, tableNamePattern, filterEmptyTables });
        tables = await getOracleTables(params, sendProgress, ownerFilter, tableNamePattern, abortSignal, filterEmptyTables);
        console.log(`Got ${tables.length} tables for Oracle`);
      } else if (ds.type === 'dameng') {
        const params: DamengConnectionParams = {
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        };
        console.log('Calling getDamengTables with tableNamePattern:', tableNamePattern);
        tables = await getDamengTables(params, sendProgress, tableNamePattern, abortSignal, filterEmptyTables);
        console.log(`Got ${tables.length} tables for Dameng`);
      } else {
        throw new Error('不支持的数据库类型');
      }

      if (useCache && tables.length > 0) {
        console.log('Caching schema...');
        setSchemaCache(dataSourceId, tables, cacheKey);
        cleanOldSchemaCache(7);
      }

      return tables;
    } catch (error) {
      console.error('Error getting schema:', error);
      throw error;
    } finally {
      schemaAbortController = null;
    }
  });

  ipcMain.handle('db:getSchemaFromCache', async (_, dataSourceId: string) => {
    try {
      console.log('=== db:getSchemaFromCache called ===');
      console.log('dataSourceId:', dataSourceId);
      
      const cache = getSchemaCache(dataSourceId, undefined, true);
      if (cache) {
        console.log('Found cached schema');
        return cache.schemaData;
      } else {
        console.log('No cached schema found');
        return [];
      }
    } catch (error) {
      console.error('Error getting schema from cache:', error);
      throw error;
    }
  });

  ipcMain.handle('db:cancelSchemaLoad', async () => {
    try {
      console.log('=== db:cancelSchemaLoad called ===');
      if (schemaAbortController) {
        schemaAbortController.abort();
        schemaAbortController = null;
        console.log('Schema load cancelled');
      } else {
        console.log('No schema load in progress');
      }
    } catch (error) {
      console.error('Error cancelling schema load:', error);
      throw error;
    }
  });

  ipcMain.handle('db:removeTableFromCache', async (_, dataSourceId: string, tableName: string) => {
    try {
      console.log('Removing table from cache:', dataSourceId, tableName);
      removeTableFromSchemaCache(dataSourceId, tableName);
      console.log('Table removed from cache');
    } catch (error) {
      console.error('Error removing table from cache:', error);
      throw error;
    }
  });

  ipcMain.handle('db:removeTablesFromCache', async (_, dataSourceId: string, tableNames: string[]) => {
    try {
      console.log('Removing tables from cache:', dataSourceId, tableNames);
      removeTablesFromSchemaCache(dataSourceId, tableNames);
      console.log('Tables removed from cache');
    } catch (error) {
      console.error('Error removing tables from cache:', error);
      throw error;
    }
  });

  ipcMain.handle('db:executeQuery', async (_, dataSourceId: string, sql: string) => {
    try {
      console.log('Executing query on data source:', dataSourceId, sql);
      const ds = getDataSourceById(dataSourceId);
      if (!ds) {
        throw new Error('数据源不存在');
      }

      if (ds.type === 'oracle') {
        const params: OracleConnectionParams = {
          host: ds.host,
          port: ds.port,
          serviceName: ds.serviceName,
          sid: ds.sid,
          username: ds.username,
          password: ds.password,
          schema: ds.schema,
        };
        const result = await executeOracleQuery(params, sql);
        addQueryHistory({
          sql,
          executedAt: new Date().toISOString(),
          executionTime: result.executionTime,
          rowCount: result.rowCount,
          dataSourceId: ds.id,
          dataSourceName: ds.name,
        });
        return result;
      } else if (ds.type === 'dameng') {
        const params: DamengConnectionParams = {
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        };
        const result = await executeDamengQuery(params, sql);
        addQueryHistory({
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
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  });

  console.log('All IPC handlers registered');
}

async function testOracleConnection(params: OracleConnectionParams) {
  const oracle = await import('../database/oracle');
  return oracle.testOracleConnection(params);
}

async function testDamengConnection(params: DamengConnectionParams) {
  const dameng = await import('../database/dameng');
  return dameng.testDamengConnection(params);
}
