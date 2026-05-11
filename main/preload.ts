import { contextBridge, ipcRenderer } from 'electron';

export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
}

export interface AnalysisRequest {
  description: string;
  logId: string;
  projectId: string;
  aiModel: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: any[];
  toolCallId?: string;
  name?: string;
}

export interface AnalysisResult {
  success: boolean;
  message: string;
  conversation: ConversationMessage[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceRecord {
  id: string;
  projectId: string;
  name: string;
  type: 'oracle' | 'dameng';
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  schema?: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfigRecord {
  id: string;
  projectId: string;
  apiBaseUrl?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
  apiLogPath?: string;
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  redisDb?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProjectDetails {
  project: ProjectRecord | undefined;
  dataSource: DataSourceRecord | undefined;
  config: ProjectConfigRecord | undefined;
}

export interface ElectronAPI {
  getDataSources: () => Promise<any[]>;
  createDataSource: (ds: any) => Promise<any>;
  updateDataSource: (id: string, ds: any) => Promise<any>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  getActiveDataSource: () => Promise<any>;
  testConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
  getQueryHistory: () => Promise<any[]>;
  clearQueryHistory: () => Promise<void>;
  getSchema: (dataSourceId: string, ownerFilter?: string, tableNamePattern?: string, useCache?: boolean, filterEmptyTables?: boolean) => Promise<any[]>;
  getSchemaFromCache: (dataSourceId: string) => Promise<any[]>;
  executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
  onSchemaProgress: (callback: (progress: SchemaProgress) => void) => () => void;
  cancelSchemaLoad: () => Promise<void>;
  removeTableFromCache: (dataSourceId: string, tableName: string) => Promise<void>;
  removeTablesFromCache: (dataSourceId: string, tableNames: string[]) => Promise<void>;
  startAnalysis: (request: AnalysisRequest) => Promise<AnalysisResult>;
  chatWithAI: (message: string, projectId: string) => Promise<AnalysisResult>;
  setGitLabConfig: (config: { baseUrl: string; token: string; defaultBranch?: string }) => Promise<{ success: boolean; message: string }>;
  onAIStream: (callback: (content: string) => void) => () => void;
  project: {
    getAll: () => Promise<ProjectRecord[]>;
    getById: (id: string) => Promise<ProjectRecord | undefined>;
    create: (project: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectRecord>;
    update: (id: string, project: Partial<ProjectRecord>) => Promise<ProjectRecord | undefined>;
    delete: (id: string) => Promise<void>;
    setActive: (id: string) => Promise<void>;
    getActive: () => Promise<ProjectRecord | undefined>;
    getActiveWithDetails: () => Promise<ActiveProjectDetails>;
    getDataSource: (projectId: string) => Promise<DataSourceRecord | undefined>;
    createDataSource: (ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & { password: string }) => Promise<DataSourceRecord>;
    updateDataSource: (id: string, ds: Partial<DataSourceRecord>) => Promise<DataSourceRecord | undefined>;
    deleteDataSource: (id: string) => Promise<void>;
    getConfig: (projectId: string) => Promise<ProjectConfigRecord | undefined>;
    saveConfig: (config: Omit<ProjectConfigRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectConfigRecord>;
    testDataSourceConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
    executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
  };
}

const api: ElectronAPI = {
  getDataSources: () => ipcRenderer.invoke('db:getDataSources'),
  createDataSource: (ds) => ipcRenderer.invoke('db:createDataSource', ds),
  updateDataSource: (id, ds) => ipcRenderer.invoke('db:updateDataSource', id, ds),
  deleteDataSource: (id) => ipcRenderer.invoke('db:deleteDataSource', id),
  setActiveDataSource: (id) => ipcRenderer.invoke('db:setActiveDataSource', id),
  getActiveDataSource: () => ipcRenderer.invoke('db:getActiveDataSource'),
  testConnection: (ds) => ipcRenderer.invoke('db:testConnection', ds),
  getQueryHistory: () => ipcRenderer.invoke('db:getQueryHistory'),
  clearQueryHistory: () => ipcRenderer.invoke('db:clearQueryHistory'),
  getSchema: (dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false) => ipcRenderer.invoke('db:getSchema', dataSourceId, ownerFilter, tableNamePattern, useCache, filterEmptyTables),
  getSchemaFromCache: (dataSourceId) => ipcRenderer.invoke('db:getSchemaFromCache', dataSourceId),
  executeQuery: (dataSourceId, sql) => ipcRenderer.invoke('db:executeQuery', dataSourceId, sql),
  onSchemaProgress: (callback) => {
    const handler = (_: any, progress: SchemaProgress) => callback(progress);
    ipcRenderer.on('schema:progress', handler);
    return () => ipcRenderer.removeListener('schema:progress', handler);
  },
  cancelSchemaLoad: () => ipcRenderer.invoke('db:cancelSchemaLoad'),
  removeTableFromCache: (dataSourceId, tableName) => ipcRenderer.invoke('db:removeTableFromCache', dataSourceId, tableName),
  removeTablesFromCache: (dataSourceId, tableNames) => ipcRenderer.invoke('db:removeTablesFromCache', dataSourceId, tableNames),
  startAnalysis: (request) => ipcRenderer.invoke('ai:startAnalysis', request),
  chatWithAI: (message, projectId) => ipcRenderer.invoke('ai:chat', message, projectId),
  setGitLabConfig: (config) => ipcRenderer.invoke('ai:setGitLabConfig', config),
  onAIStream: (callback) => {
    const handler = (_: any, content: string) => callback(content);
    ipcRenderer.on('ai:stream', handler);
    return () => ipcRenderer.removeListener('ai:stream', handler);
  },
  project: {
    getAll: () => ipcRenderer.invoke('project:getAll'),
    getById: (id) => ipcRenderer.invoke('project:getById', id),
    create: (project) => ipcRenderer.invoke('project:create', project),
    update: (id, project) => ipcRenderer.invoke('project:update', id, project),
    delete: (id) => ipcRenderer.invoke('project:delete', id),
    setActive: (id) => ipcRenderer.invoke('project:setActive', id),
    getActive: () => ipcRenderer.invoke('project:getActive'),
    getActiveWithDetails: () => ipcRenderer.invoke('project:getActiveWithDetails'),
    getDataSource: (projectId) => ipcRenderer.invoke('project:getDataSource', projectId),
    createDataSource: (ds) => ipcRenderer.invoke('project:createDataSource', ds),
    updateDataSource: (id, ds) => ipcRenderer.invoke('project:updateDataSource', id, ds),
    deleteDataSource: (id) => ipcRenderer.invoke('project:deleteDataSource', id),
    getConfig: (projectId) => ipcRenderer.invoke('project:getConfig', projectId),
    saveConfig: (config) => ipcRenderer.invoke('project:saveConfig', config),
    testDataSourceConnection: (ds) => ipcRenderer.invoke('project:testDataSourceConnection', ds),
    executeQuery: (dataSourceId, sql) => ipcRenderer.invoke('project:executeQuery', dataSourceId, sql),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
