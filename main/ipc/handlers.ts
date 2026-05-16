import { ipcMain, BrowserWindow } from 'electron';
import { mergeSchemaIncremental } from '../database/schemaMerge';
import {
  createAgent,
  ChatSession,
  AnalysisRequest,
  AnalysisStepData,
  AnalysisStepId,
  ConversationMessage,
} from '../agent';
import {
  getAllProjects,
  getActiveProjectWithDetails,
  getCodeRepositoriesByProjectId,
  getGlobalConfig,
  createOrUpdateGlobalConfig,
  getSchemaCache,
  setSchemaCache,
  getDataSourceById,
  getActiveDataSource,
  getAllDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  setActiveProject,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectConfig,
  createOrUpdateProjectConfig,
  getProjectDataSourceById,
  createProjectDataSource,
  updateProjectDataSource,
  deleteProjectDataSource,
  getCodeRepositoryById,
  createCodeRepository,
  updateCodeRepository,
  deleteCodeRepository,
  createDefaultCodeRepositories,
  matchCodeRepository,
  inferBranchFromTag,
  getQueryHistory,
  addQueryHistory,
  clearQueryHistory,
  removeTableFromSchemaCache,
  removeTablesFromSchemaCache,
} from '../database/sqlite';
import { getOracleTables, executeOracleQuery, testOracleConnection } from '../database/oracle';
import { getDamengTables, executeDamengQuery, testDamengConnection } from '../database/dameng';
import { testRedisConnection, getTokensFromRedis, getFirstTokenFromRedis } from '../redis';
import { updateGitLabConfig } from '../agent/tools/gitLab';

let currentAbortController: AbortController | null = null;
const chatSessions = new Map<string, ChatSession>();

export function registerIpcHandlers() {
  // 启动时从全局配置初始化 GitLab 配置
  try {
    const globalConfig = getGlobalConfig();
    if (globalConfig) {
      updateGitLabConfig({
        baseUrl: globalConfig.gitLabBaseUrl,
        token: globalConfig.gitLabToken,
      });
    }
  } catch (e) {
    console.error('Failed to initialize GitLab config from global config:', e);
  }

  ipcMain.handle('api:startAnalysis', async (_event, request: AnalysisRequest) => {
    try {
      const agent = createAgent();
      const mainWindow = BrowserWindow.getAllWindows()[0];

      if (!mainWindow) {
        throw new Error('未找到主窗口');
      }

      const steps: AnalysisStepData[] = [];

      const callback = {
        onStepStart: (stepId: AnalysisStepId) => {
          console.log(`[IPC] Step started: ${stepId}`);
          const step = steps.find(s => s.id === stepId);
          if (step) {
            step.status = 'loading';
          }
          mainWindow.webContents.send('analysis:stepUpdate', { id: stepId, status: 'loading' });
        },

        onStepUpdate: (stepData: AnalysisStepData) => {
          const existingIndex = steps.findIndex(s => s.id === stepData.id);
          if (existingIndex >= 0) {
            steps[existingIndex] = stepData;
          } else {
            steps.push(stepData);
          }
          mainWindow.webContents.send('analysis:stepUpdate', stepData);
        },

        onStepComplete: (stepData: AnalysisStepData) => {
          const existingIndex = steps.findIndex(s => s.id === stepData.id);
          if (existingIndex >= 0) {
            steps[existingIndex] = stepData;
          } else {
            steps.push(stepData);
          }
          mainWindow.webContents.send('analysis:stepComplete', stepData);
        },

        onStepError: (stepId: AnalysisStepId, error: string) => {
          console.error(`[IPC] Step error: ${stepId} - ${error}`);
          const step = steps.find(s => s.id === stepId);
          const stepData: AnalysisStepData = {
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
          } else {
            steps.push(stepData);
          }
          mainWindow.webContents.send('analysis:stepError', stepData);
        },

        onStreamChunk: (content: string) => {
          mainWindow.webContents.send('analysis:streamChunk', content);
        },
      };

      const conversation = await agent.runStepByStep(request, callback);

      chatSessions.set(request.projectId, new ChatSession(conversation, {
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
    } catch (error) {
      console.error('Analysis error:', error);
      return {
        success: false,
        message: (error as Error).message || '分析过程发生错误',
        steps: [],
      };
    }
  });

  ipcMain.handle('db:getGlobalConfig', async () => {
    try {
      return getGlobalConfig();
    } catch (error) {
      console.error('Error getting global config:', error);
      throw error;
    }
  });

  ipcMain.handle('db:saveGlobalConfig', async (_event, config: any) => {
    try {
      const result = createOrUpdateGlobalConfig(config);
      // 同步更新内存中的 GitLab 配置
      updateGitLabConfig({
        baseUrl: config.gitLabBaseUrl,
        token: config.gitLabToken,
      });
      return result;
    } catch (error) {
      console.error('Error saving global config:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getCodeRepositories', async (_event, projectId: string) => {
    try {
      return getCodeRepositoriesByProjectId(projectId);
    } catch (error) {
      console.error('Error getting code repositories:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getSchemaFromCache', async (_event, dataSourceId: string) => {
    try {
      const cache = getSchemaCache(dataSourceId);
      return cache?.schemaData || [];
    } catch (error) {
      console.error('Error getting schema from cache:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'db:getSchema',
    async (
      _event,
      dataSourceId: string,
      ownerFilter?: string,
      tableNamePattern?: string,
      useCache: boolean = true,
      filterEmptyTables: boolean = false,
      mergeWithExistingCache: boolean = false,
      filterNoCommentTables: boolean = true
    ) => {
    try {
      if (currentAbortController) {
        currentAbortController.abort();
      }
      currentAbortController = new AbortController();

      const dataSource = getDataSourceById(dataSourceId);
      if (!dataSource) {
        throw new Error('数据源不存在');
      }

      if (useCache) {
        const cache = getSchemaCache(dataSourceId, undefined, true);
        if (cache && cache.schemaData && cache.schemaData.length > 0) {
          return cache.schemaData;
        }
      }

      let tables: any[] = [];
      const abortSignal = currentAbortController.signal;

      const progressWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const onSchemaProgress = (progress: import('../database/oracle').SchemaProgress) => {
        progressWindow?.webContents.send('schema:progress', progress);
      };

      if (dataSource.type === 'oracle') {
        tables = await getOracleTables(
          {
            host: dataSource.host,
            port: dataSource.port,
            serviceName: dataSource.serviceName,
            sid: dataSource.sid,
            username: dataSource.username,
            password: dataSource.password,
            schema: dataSource.schema,
          },
          onSchemaProgress,
          ownerFilter,
          tableNamePattern,
          abortSignal,
          filterEmptyTables,
          filterNoCommentTables
        );
      } else if (dataSource.type === 'dameng') {
        tables = await getDamengTables(
          {
            host: dataSource.host,
            port: dataSource.port,
            schema: dataSource.schema || dataSource.username,
            username: dataSource.username,
            password: dataSource.password,
          },
          onSchemaProgress,
          tableNamePattern,
          abortSignal,
          filterEmptyTables,
          filterNoCommentTables
        );
      }

      let tablesToSave = tables;
      if (mergeWithExistingCache) {
        const existing = getSchemaCache(dataSourceId, undefined, true);
        const base =
          existing?.schemaData && Array.isArray(existing.schemaData) ? existing.schemaData : [];
        tablesToSave = mergeSchemaIncremental(base, tables);
        console.log('[db:getSchema] mergeWithExistingCache: base', base.length, '+ fetched', tables.length, '=>', tablesToSave.length);
      }

      setSchemaCache(dataSourceId, tablesToSave, undefined);

      return tablesToSave;
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        return [];
      }
      console.error('Error getting schema:', error);
      throw error;
    }
  });

  ipcMain.handle('db:cancelSchemaLoad', async () => {
    try {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      return { success: true };
    } catch (error) {
      console.error('Error cancelling schema load:', error);
      throw error;
    }
  });

  ipcMain.handle('db:executeQuery', async (_event, dataSourceId: string, sql: string) => {
    try {
      const dataSource = getDataSourceById(dataSourceId);
      if (!dataSource) {
        throw new Error('数据源不存在');
      }

      let result: any;
      const startTime = Date.now();

      if (dataSource.type === 'oracle') {
        result = await executeOracleQuery(
          {
            host: dataSource.host,
            port: dataSource.port,
            serviceName: dataSource.serviceName,
            sid: dataSource.sid,
            username: dataSource.username,
            password: dataSource.password,
          },
          sql
        );
      } else if (dataSource.type === 'dameng') {
        result = await executeDamengQuery(
          {
            host: dataSource.host,
            port: dataSource.port,
            schema: dataSource.schema || dataSource.username,
            username: dataSource.username,
            password: dataSource.password,
          },
          sql
        );
      }

      addQueryHistory({
        sql,
        executedAt: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        rowCount: result.rowCount,
        dataSourceId,
        dataSourceName: dataSource.name,
      });

      return result;
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  });

  ipcMain.handle('db:testConnection', async (_event, ds: any) => {
    try {
      if (ds.type === 'oracle') {
        return await testOracleConnection({
          host: ds.host,
          port: ds.port,
          serviceName: ds.serviceName,
          sid: ds.sid,
          username: ds.username,
          password: ds.password,
          schema: ds.schema,
        });
      } else if (ds.type === 'dameng') {
        return await testDamengConnection({
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        });
      }
      throw new Error('不支持的数据库类型');
    } catch (error) {
      console.error('Error testing connection:', error);
      return { success: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('db:getDataSources', async () => {
    try {
      return getAllDataSources();
    } catch (error) {
      console.error('Error getting data sources:', error);
      throw error;
    }
  });

  ipcMain.handle('db:createDataSource', async (_event, ds: any) => {
    try {
      return createDataSource(ds);
    } catch (error) {
      console.error('Error creating data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:updateDataSource', async (_event, id: string, ds: any) => {
    try {
      return updateDataSource(id, ds);
    } catch (error) {
      console.error('Error updating data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:deleteDataSource', async (_event, id: string) => {
    try {
      return deleteDataSource(id);
    } catch (error) {
      console.error('Error deleting data source:', error);
      throw error;
    }
  });

  ipcMain.handle('db:setActiveDataSource', async (_event, id: string) => {
    try {
      const dataSource = getDataSourceById(id);
      if (dataSource) {
        setActiveProject(dataSource.projectId);
      }
      return { success: true };
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

  ipcMain.handle('db:getQueryHistory', async () => {
    try {
      return getQueryHistory();
    } catch (error) {
      console.error('Error getting query history:', error);
      throw error;
    }
  });

  ipcMain.handle('db:clearQueryHistory', async () => {
    try {
      return clearQueryHistory();
    } catch (error) {
      console.error('Error clearing query history:', error);
      throw error;
    }
  });

  ipcMain.handle('db:removeTableFromCache', async (_event, dataSourceId: string, tableName: string) => {
    try {
      return removeTableFromSchemaCache(dataSourceId, tableName);
    } catch (error) {
      console.error('Error removing table from cache:', error);
      throw error;
    }
  });

  ipcMain.handle('db:removeTablesFromCache', async (_event, dataSourceId: string, tableNames: string[]) => {
    try {
      return removeTablesFromSchemaCache(dataSourceId, tableNames);
    } catch (error) {
      console.error('Error removing tables from cache:', error);
      throw error;
    }
  });

  ipcMain.handle('db:getCodeRepositoryById', async (_event, id: string) => {
    try {
      return getCodeRepositoryById(id);
    } catch (error) {
      console.error('Error getting code repository by id:', error);
      throw error;
    }
  });

  ipcMain.handle('db:createCodeRepository', async (_event, repo: any) => {
    try {
      return createCodeRepository(repo);
    } catch (error) {
      console.error('Error creating code repository:', error);
      throw error;
    }
  });

  ipcMain.handle('db:updateCodeRepository', async (_event, id: string, updates: any) => {
    try {
      return updateCodeRepository(id, updates);
    } catch (error) {
      console.error('Error updating code repository:', error);
      throw error;
    }
  });

  ipcMain.handle('db:deleteCodeRepository', async (_event, id: string) => {
    try {
      return deleteCodeRepository(id);
    } catch (error) {
      console.error('Error deleting code repository:', error);
      throw error;
    }
  });

  ipcMain.handle('db:createDefaultCodeRepositories', async (_event, projectId: string) => {
    try {
      return createDefaultCodeRepositories(projectId);
    } catch (error) {
      console.error('Error creating default code repositories:', error);
      throw error;
    }
  });

  ipcMain.handle('db:matchCodeRepository', async (_event, projectId: string, serviceName: string, requestUrl?: string) => {
    try {
      return matchCodeRepository(projectId, serviceName, requestUrl);
    } catch (error) {
      console.error('Error matching code repository:', error);
      throw error;
    }
  });

  ipcMain.handle('db:inferBranchFromTag', async (_event, tag: string) => {
    try {
      return inferBranchFromTag(tag);
    } catch (error) {
      console.error('Error inferring branch from tag:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getAll', async () => {
    try {
      return getAllProjects();
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getById', async (_event, id: string) => {
    try {
      return getProjectById(id);
    } catch (error) {
      console.error('Error getting project by id:', error);
      throw error;
    }
  });

  ipcMain.handle('project:create', async (_event, project: any) => {
    try {
      return createProject(project);
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:update', async (_event, id: string, project: any) => {
    try {
      return updateProject(id, project);
    } catch (error) {
      console.error('Error updating project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      return deleteProject(id);
    } catch (error) {
      console.error('Error deleting project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:setActive', async (_event, id: string) => {
    try {
      return setActiveProject(id);
    } catch (error) {
      console.error('Error setting active project:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getActive', async () => {
    try {
      const project = getProjectById('');
      const projects = getAllProjects();
      return projects.find(p => p.isActive === 1);
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

  ipcMain.handle('project:getDataSource', async (_event, projectId: string) => {
    try {
      return getProjectDataSourceById(projectId);
    } catch (error) {
      console.error('Error getting project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:createDataSource', async (_event, ds: any) => {
    try {
      return createProjectDataSource(ds);
    } catch (error) {
      console.error('Error creating project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:updateDataSource', async (_event, id: string, ds: any) => {
    try {
      return updateProjectDataSource(id, ds);
    } catch (error) {
      console.error('Error updating project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:deleteDataSource', async (_event, id: string) => {
    try {
      return deleteProjectDataSource(id);
    } catch (error) {
      console.error('Error deleting project data source:', error);
      throw error;
    }
  });

  ipcMain.handle('project:getConfig', async (_event, projectId: string) => {
    try {
      return getProjectConfig(projectId);
    } catch (error) {
      console.error('Error getting project config:', error);
      throw error;
    }
  });

  ipcMain.handle('project:saveConfig', async (_event, config: any) => {
    try {
      return createOrUpdateProjectConfig(config);
    } catch (error) {
      console.error('Error saving project config:', error);
      throw error;
    }
  });

  ipcMain.handle('project:testDataSourceConnection', async (_event, ds: any) => {
    try {
      if (ds.type === 'oracle') {
        return await testOracleConnection({
          host: ds.host,
          port: ds.port,
          serviceName: ds.serviceName,
          sid: ds.sid,
          username: ds.username,
          password: ds.password,
          schema: ds.schema,
        });
      } else if (ds.type === 'dameng') {
        return await testDamengConnection({
          host: ds.host,
          port: ds.port,
          schema: ds.schema || ds.username,
          username: ds.username,
          password: ds.password,
        });
      }
      throw new Error('不支持的数据库类型');
    } catch (error) {
      console.error('Error testing data source connection:', error);
      return { success: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('project:executeQuery', async (_event, dataSourceId: string, sql: string) => {
    try {
      const dataSource = getProjectDataSourceById(dataSourceId);
      if (!dataSource) {
        throw new Error('数据源不存在');
      }

      let result: any;
      const startTime = Date.now();

      if (dataSource.type === 'oracle') {
        result = await executeOracleQuery(
          {
            host: dataSource.host,
            port: dataSource.port,
            serviceName: dataSource.serviceName,
            sid: dataSource.sid,
            username: dataSource.username,
            password: dataSource.password,
          },
          sql
        );
      } else if (dataSource.type === 'dameng') {
        result = await executeDamengQuery(
          {
            host: dataSource.host,
            port: dataSource.port,
            schema: dataSource.schema || dataSource.username,
            username: dataSource.username,
            password: dataSource.password,
          },
          sql
        );
      }

      addQueryHistory({
        sql,
        executedAt: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        rowCount: result.rowCount,
        dataSourceId,
        dataSourceName: dataSource.name,
      });

      return result;
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  });

  ipcMain.handle('ai:chat', async (_event, message: string, projectId: string) => {
    try {
      return { success: false, message: 'AI chat not implemented in direct IPC' };
    } catch (error) {
      console.error('Error in AI chat:', error);
      throw error;
    }
  });

  ipcMain.handle('ai:setGitLabConfig', async (_event, config: any) => {
    try {
      updateGitLabConfig(config);
      return { success: true };
    } catch (error) {
      console.error('Error setting GitLab config:', error);
      throw error;
    }
  });

  ipcMain.handle('ai:testGetCode', async (_event, params: any) => {
    try {
      return { success: false, message: 'testGetCode not implemented' };
    } catch (error) {
      console.error('Error testing get code:', error);
      throw error;
    }
  });

  ipcMain.handle('redis:testConnection', async (_event, config: any) => {
    try {
      return await testRedisConnection({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db || 0,
      });
    } catch (error) {
      console.error('Error testing Redis connection:', error);
      return { success: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('redis:getTokens', async (_event, config: any, prefix: string) => {
    try {
      return await getTokensFromRedis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db || 0,
      }, prefix);
    } catch (error) {
      console.error('Error getting Redis tokens:', error);
      throw error;
    }
  });

  ipcMain.handle('redis:getFirstToken', async (_event, config: any, prefix: string) => {
    try {
      const token = await getFirstTokenFromRedis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db || 0,
      }, prefix);
      if (token) {
        return { success: true, token };
      } else {
        return { success: false, token: null, message: '未找到 Token' };
      }
    } catch (error) {
      console.error('Error getting first Redis token:', error);
      return { success: false, token: null, message: (error as Error).message };
    }
  });

  ipcMain.handle('api:getModuleVersions', async (_event, config: any) => {
    try {
      return { success: false, message: 'getModuleVersions not implemented' };
    } catch (error) {
      console.error('Error getting module versions:', error);
      throw error;
    }
  });

  ipcMain.handle('api:getLogs', async (_event, config: any) => {
    try {
      return { success: false, message: 'getLogs not implemented' };
    } catch (error) {
      console.error('Error getting logs:', error);
      throw error;
    }
  });

  ipcMain.handle('chat:sendMessage', async (_event, projectId: string, message: string) => {
    try {
      const session = chatSessions.get(projectId);
      if (!session) {
        return { success: false, message: '聊天会话不存在，请先完成分析' };
      }

      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        throw new Error('未找到主窗口');
      }

      const result = await session.sendMessage(message, (chunk) => {
        mainWindow.webContents.send('chat:streamChunk', { projectId, chunk });
      });

      return { success: true, content: result.content };
    } catch (error) {
      console.error('Chat error:', error);
      return {
        success: false,
        message: (error as Error).message || '对话过程发生错误',
      };
    }
  });
}