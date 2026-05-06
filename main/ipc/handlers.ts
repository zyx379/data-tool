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
} from '../database/sqlite';
import { getOracleTables, executeOracleQuery, OracleConnectionParams } from '../database/oracle';
import { getDamengTables, executeDamengQuery, DamengConnectionParams } from '../database/dameng';

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

  ipcMain.handle('db:getSchema', async (event, dataSourceId: string, ownerFilter?: string) => {
    try {
      console.log('=== db:getSchema called ===');
      console.log('dataSourceId:', dataSourceId);
      console.log('ownerFilter (received):', ownerFilter);
      const ds = getDataSourceById(dataSourceId);
      if (!ds) {
        throw new Error('数据源不存在');
      }

      const sendProgress = (progress: any) => {
        event.sender.send('schema:progress', progress);
      };

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
        const tables = await getOracleTables(params, sendProgress, ownerFilter);
        console.log(`Got ${tables.length} tables for Oracle`);
        return tables;
      } else if (ds.type === 'dameng') {
        const params: DamengConnectionParams = {
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        };
        const tables = await getDamengTables(params, sendProgress);
        console.log(`Got ${tables.length} tables for Dameng`);
        return tables;
      }
      throw new Error('不支持的数据库类型');
    } catch (error) {
      console.error('Error getting schema:', error);
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
