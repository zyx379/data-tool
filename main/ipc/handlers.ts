import { ipcMain } from 'electron';
import {
  getAllDataSources,
  getDataSourceById,
  getDataSourceByProjectId,
  createDataSource,
  updateDataSource,
  deleteDataSource,
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
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  setActiveProject,
  getActiveProject,
  getActiveProjectWithDetails,
  createProjectDataSource,
  updateProjectDataSource,
  deleteProjectDataSource,
  getProjectConfig,
  createOrUpdateProjectConfig,
} from '../database/sqlite';
import { getOracleTables, executeOracleQuery, OracleConnectionParams } from '../database/oracle';
import { getDamengTables, executeDamengQuery, DamengConnectionParams } from '../database/dameng';
import { HISAnalysisAgent, AnalysisRequest, ConversationMessage } from '../agent';
import { DEEPSEEK_CONFIG } from '../agent/config';
import { updateGitLabConfig } from '../agent/tools/gitLab';

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
      console.log('=== [DEBUG] db:getSchema called ===');
      console.log('[DEBUG] dataSourceId:', dataSourceId);
      console.log('[DEBUG] ownerFilter (received):', ownerFilter);
      console.log('[DEBUG] tableNamePattern (received):', tableNamePattern);
      console.log('[DEBUG] useCache:', useCache);
      console.log('[DEBUG] filterEmptyTables:', filterEmptyTables);
      
      const ds = getDataSourceById(dataSourceId);
      
      if (!ds) {
        console.error('[DEBUG] Data source not found!');
        throw new Error('数据源不存在');
      }
      console.log('[DEBUG] DataSource type:', ds.type);
      console.log('[DEBUG] DataSource schema:', ds.schema);

      const cacheKey = `${ownerFilter || ''}:${tableNamePattern || ''}:${filterEmptyTables ? 'filterEmpty' : ''}`;
      console.log('[DEBUG] Generated cacheKey:', cacheKey);
      
      if (useCache) {
        console.log('[DEBUG] Attempting to use cache...');
        const cached = getSchemaCache(dataSourceId, cacheKey);
        if (cached) {
          console.log('[DEBUG] Found cache entry');
          const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
          const cacheAgeHours = cacheAgeMs / (1000 * 60 * 60);
          
          if (cacheAgeHours < 24) {
            console.log(`[DEBUG] Using cached schema (age: ${cacheAgeHours.toFixed(2)} hours), tables: ${cached.schemaData?.length}`);
            return cached.schemaData;
          } else {
            console.log(`[DEBUG] Cache expired (age: ${cacheAgeHours.toFixed(2)} hours), fetching fresh`);
          }
        } else {
          console.log('[DEBUG] No cached schema found for key:', cacheKey);
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
        console.log('[DEBUG] Calling getOracleTables with params:', { ownerFilter, tableNamePattern, filterEmptyTables });
        tables = await getOracleTables(params, sendProgress, ownerFilter, tableNamePattern, abortSignal, filterEmptyTables);
        console.log(`[DEBUG] Got ${tables.length} tables for Oracle`);
      } else if (ds.type === 'dameng') {
        const params: DamengConnectionParams = {
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        };
        console.log('[DEBUG] Calling getDamengTables with tableNamePattern:', tableNamePattern);
        tables = await getDamengTables(params, sendProgress, tableNamePattern, abortSignal, filterEmptyTables);
        console.log(`[DEBUG] Got ${tables.length} tables for Dameng`);
      } else {
        throw new Error('不支持的数据库类型');
      }

      // 无论什么情况，只要我们成功获取了表结构，就保存缓存！
      console.log('[DEBUG] ========== Attempting to save cache ==========');
      console.log('[DEBUG] useCache:', useCache);
      console.log('[DEBUG] tables.length:', tables.length);
      
      if (tables.length > 0) {
        try {
          console.log('[DEBUG] Caching schema with', tables.length, 'tables and cacheKey:', cacheKey);
          setSchemaCache(dataSourceId, tables, cacheKey);
          cleanOldSchemaCache(7);
          console.log('[DEBUG] Cache saved successfully!');
        } catch (cacheError) {
          console.error('[DEBUG] ERROR saving cache:', cacheError);
        }
      } else {
        console.log('[DEBUG] No tables to cache');
      }

      return tables;
    } catch (error) {
      console.error('[DEBUG] Error getting schema:', error);
      throw error;
    } finally {
      schemaAbortController = null;
    }
  });

  ipcMain.handle('db:getSchemaFromCache', async (_, dataSourceId: string) => {
    try {
      console.log('=== [DEBUG] db:getSchemaFromCache called ===');
      console.log('[DEBUG] dataSourceId:', dataSourceId);
      
      const cache = getSchemaCache(dataSourceId, undefined, true);
      if (cache) {
        console.log('[DEBUG] Found cached schema');
        console.log('[DEBUG] schemaData length:', cache.schemaData?.length);
        console.log('[DEBUG] cachedAt:', cache.cachedAt);
        return cache.schemaData;
      } else {
        console.log('[DEBUG] No cached schema found');
        return [];
      }
    } catch (error) {
      console.error('[DEBUG] Error getting schema from cache:', error);
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

  ipcMain.handle('project:getAll', async () => {
    try {
      return getAllProjects();
    } catch (error) {
      console.error('Error getting projects:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getById', async (_, id: string) => {
    try {
      return getProjectById(id);
    } catch (error) {
      console.error('Error getting project by id:', error);
      throw error;
    }
  });

  ipcMain.handle('project:create', async (_, project: any) => {
    try {
      console.log('Creating project:', project);
      const result = createProject(project);
      console.log('Project created:', result);
      return result;
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:update', async (_, id: string, project: any) => {
    try {
      console.log('Updating project:', id, project);
      const result = updateProject(id, project);
      console.log('Project updated:', result);
      return result;
    } catch (error) {
      console.error('Error updating project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:delete', async (_, id: string) => {
    try {
      console.log('Deleting project:', id);
      deleteProject(id);
      console.log('Project deleted');
    } catch (error) {
      console.error('Error deleting project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:setActive', async (_, id: string) => {
    try {
      console.log('Setting active project:', id);
      setActiveProject(id);
      console.log('Active project set');
    } catch (error) {
      console.error('Error setting active project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getActive', async () => {
    try {
      return getActiveProject();
    } catch (error) {
      console.error('Error getting active project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getActiveWithDetails', async () => {
    try {
      return getActiveProjectWithDetails();
    } catch (error) {
      console.error('Error getting active project with details:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getDataSource', async (_, projectId: string) => {
    try {
      return getDataSourceByProjectId(projectId);
    } catch (error) {
      console.error('Error getting project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:createDataSource', async (_, ds: any) => {
    try {
      console.log('Creating project data source:', ds);
      const result = createProjectDataSource(ds);
      console.log('Project data source created:', result);
      return result;
    } catch (error) {
      console.error('Error creating project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:updateDataSource', async (_, id: string, ds: any) => {
    try {
      console.log('Updating project data source:', id, ds);
      const result = updateProjectDataSource(id, ds);
      console.log('Project data source updated:', result);
      return result;
    } catch (error) {
      console.error('Error updating project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:deleteDataSource', async (_, id: string) => {
    try {
      console.log('Deleting project data source:', id);
      deleteProjectDataSource(id);
      console.log('Project data source deleted');
    } catch (error) {
      console.error('Error deleting project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getConfig', async (_, projectId: string) => {
    try {
      return getProjectConfig(projectId);
    } catch (error) {
      console.error('Error getting project config:', error);
      throw error;
    }
  });

  ipcMain.handle('project:saveConfig', async (_, config: any) => {
    try {
      console.log('Saving project config:', config);
      const result = createOrUpdateProjectConfig(config);
      console.log('Project config saved:', result);
      return result;
    } catch (error) {
      console.error('Error saving project config:', error);
      throw error;
    }
  });

  ipcMain.handle('project:testDataSourceConnection', async (_, ds: any) => {
    try {
      console.log('Testing project data source connection:', ds);
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
      console.error('Project data source connection test failed:', error);
      return { success: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('project:executeQuery', async (_, dataSourceId: string, sql: string) => {
    try {
      console.log('Executing query on project data source:', dataSourceId, sql);
      const dataSource = getDataSourceById(dataSourceId);
      if (!dataSource) {
        throw new Error('数据源不存在');
      }

      if (dataSource.type === 'oracle') {
        const params: OracleConnectionParams = {
          host: dataSource.host,
          port: dataSource.port,
          serviceName: dataSource.serviceName,
          sid: dataSource.sid,
          username: dataSource.username,
          password: dataSource.password,
          schema: dataSource.schema,
        };
        const result = await executeOracleQuery(params, sql);
        addQueryHistory({
          sql,
          executedAt: new Date().toISOString(),
          executionTime: result.executionTime,
          rowCount: result.rowCount,
          dataSourceId: dataSource.id,
          dataSourceName: dataSource.name,
        });
        return result;
      } else if (dataSource.type === 'dameng') {
        const params: DamengConnectionParams = {
          host: dataSource.host,
          port: dataSource.port,
          schema: dataSource.schema || dataSource.username,
          username: dataSource.username,
          password: dataSource.password,
        };
        const result = await executeDamengQuery(params, sql);
        addQueryHistory({
          sql,
          executedAt: new Date().toISOString(),
          executionTime: result.executionTime,
          rowCount: result.rowCount,
          dataSourceId: dataSource.id,
          dataSourceName: dataSource.name,
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

  ipcMain.handle('ai:startAnalysis', async (event, request: AnalysisRequest) => {
    try {
      console.log('Starting AI analysis:', request);
      
      const agent = new HISAnalysisAgent({
        apiKey: DEEPSEEK_CONFIG.apiKey,
        streamCallback: (content) => {
          event.sender.send('ai:stream', content);
        }
      });

      const result = await agent.analyze(request);
      return result;
    } catch (error) {
      console.error('AI analysis error:', error);
      return {
        success: false,
        message: `分析失败: ${(error as Error).message}`,
        conversation: [],
      };
    }
  });

  ipcMain.handle('ai:chat', async (event, message: string, dataSourceId: string) => {
    try {
      console.log('AI chat:', message);

      const agent = new HISAnalysisAgent({
        apiKey: DEEPSEEK_CONFIG.apiKey,
        streamCallback: (content) => {
          event.sender.send('ai:stream', content);
        }
      });

      const result = await agent.chat(message, dataSourceId);
      return result;
    } catch (error) {
      console.error('AI chat error:', error);
      return {
        success: false,
        message: `对话失败: ${(error as Error).message}`,
        conversation: [],
      };
    }
  });

  ipcMain.handle('ai:setGitLabConfig', async (_, config: { baseUrl: string; token: string; defaultBranch?: string }) => {
    try {
      updateGitLabConfig({
        baseUrl: config.baseUrl,
        token: config.token,
        defaultBranch: config.defaultBranch,
      });
      return { success: true, message: 'GitLab 配置已更新' };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  });

  console.log('AI analysis handlers registered');
}

async function testOracleConnection(params: OracleConnectionParams) {
  const oracle = await import('../database/oracle');
  return oracle.testOracleConnection(params);
}

async function testDamengConnection(params: DamengConnectionParams) {
  const dameng = await import('../database/dameng');
  return dameng.testDamengConnection(params);
}
