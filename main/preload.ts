import { contextBridge, ipcRenderer } from 'electron';

export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
  detail?: string;
}

export interface AnalysisRequest {
  description: string;
  logId: string;
  projectId: string;
  apiBaseUrl?: string;
  apiToken?: string;
  apiLogPath?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
}

export interface AnalysisStepData {
  id: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
  title: string;
  content: string;
  data?: any;
  error?: string;
  timestamp: string;
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
  steps?: AnalysisStepData[];
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

export interface CodeRepository {
  id: string;
  projectId: string;
  name: string;
  repositoryUrl: string;
  servicePatterns: string;
  gitLabToken?: string;
  defaultBranch?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProjectDetails {
  project: ProjectRecord | undefined;
  dataSource: DataSourceRecord | undefined;
  config: ProjectConfigRecord | undefined;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export interface ModuleVersion {
  name: string;
  version: string;
  updateTime?: string;
}

export interface LogQueryParam {
  pageSize: string;
  pageNum: string;
  indexvalue: string;
  logType: string;
  serviceName?: string;
  canary?: string;
  traceId?: string;
  logLevel?: string[];
  timestamp?: {
    startDate: string | null;
    endDate: string | null;
  };
  filterParam?: {
    searchType: string;
    termChecked: boolean;
    matchChecked: boolean;
    wildcardChecked: boolean;
    operator?: string;
    value?: string;
    searchValue?: string;
  };
}

export interface AnalyzedLogInfo {
  id: string;
  logType: string;
  logLevel: string;
  serviceName: string;
  reqUrl: string;
  httpMethod?: string;
  httpStatus?: string;
  clientIp?: string;
  operator?: string;
  runTime?: number;
  errorClass?: string;
  errorMessage?: string;
  stackTrace?: string;
  vueFile?: string;
  requestParams?: string;
  tags?: Record<string, any>;
  originalLog: any;
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
  getSchema: (dataSourceId: string, ownerFilter?: string, tableNamePattern?: string, useCache?: boolean, filterEmptyTables?: boolean, mergeWithExistingCache?: boolean, filterNoCommentTables?: boolean) => Promise<any[]>;
  getSchemaFromCache: (dataSourceId: string) => Promise<any[]>;
  executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
  onSchemaProgress: (callback: (progress: SchemaProgress) => void) => () => void;
  cancelSchemaLoad: () => Promise<void>;
  removeTableFromCache: (dataSourceId: string, tableName: string) => Promise<void>;
  removeTablesFromCache: (dataSourceId: string, tableNames: string[]) => Promise<void>;
  startAnalysis: (request: AnalysisRequest) => Promise<AnalysisResult>;
  chatWithAI: (message: string, projectId: string) => Promise<AnalysisResult>;
  setGitLabConfig: (config: { baseUrl: string; token: string; defaultBranch?: string }) => Promise<{ success: boolean; message: string }>;
  testGetCode: (params: { serviceName: string; filePath?: string; branch?: string }) => Promise<{ success: boolean; data?: any; error?: string }>;
  onAIStream: (callback: (content: string) => void) => () => void;
  onAnalysisStepUpdate: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStepComplete: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStepError: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStreamChunk: (callback: (content: string) => void) => () => void;
  sendChatMessage: (projectId: string, message: string) => Promise<{ success: boolean; content?: string; message?: string }>;
  onChatStreamChunk: (callback: (data: { projectId: string; chunk: string }) => void) => () => void;
  testRedisConnection: (config: RedisConfig) => Promise<{ success: boolean; message: string }>;
  getRedisTokens: (config: RedisConfig, prefix?: string) => Promise<{ success: boolean; tokens: string[]; message?: string }>;
  getRedisFirstToken: (config: RedisConfig, prefix?: string) => Promise<{ success: boolean; token: string | null; message?: string }>;
  getModuleVersions: (config: { 
    baseUrl: string; 
    versionPath?: string; 
    token: string;
    apiKey?: string;
    authType?: 'bearer' | 'api-key' | 'custom';
    customHeaderName?: string;
  }) => Promise<{ success: boolean; modules: ModuleVersion[]; message?: string }>;
  getLogs: (config: { 
    baseUrl: string; 
    logPath?: string; 
    token: string;
    queryParam: LogQueryParam;
    apiKey?: string;
    authType?: 'bearer' | 'api-key' | 'custom';
    customHeaderName?: string;
  }) => Promise<{ success: boolean; total: number; logs: AnalyzedLogInfo[]; message?: string }>;
  getCodeRepositories: (projectId: string) => Promise<CodeRepository[]>;
  getCodeRepositoryById: (id: string) => Promise<CodeRepository | undefined>;
  createCodeRepository: (repo: Omit<CodeRepository, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CodeRepository>;
  updateCodeRepository: (id: string, updates: Partial<CodeRepository>) => Promise<CodeRepository | undefined>;
  deleteCodeRepository: (id: string) => Promise<void>;
  createDefaultCodeRepositories: (projectId: string) => Promise<void>;
  matchCodeRepository: (projectId: string, serviceName: string, requestUrl?: string) => Promise<CodeRepository | undefined>;
  inferBranchFromTag: (tag: string) => Promise<string>;
  getGlobalConfig: () => Promise<any>;
  saveGlobalConfig: (config: any) => Promise<any>;
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
  getSchema: (dataSourceId, ownerFilter, tableNamePattern, useCache = true, filterEmptyTables = false, mergeWithExistingCache = false, filterNoCommentTables = true) =>
    ipcRenderer.invoke('db:getSchema', dataSourceId, ownerFilter, tableNamePattern, useCache, filterEmptyTables, mergeWithExistingCache, filterNoCommentTables),
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
  startAnalysis: (request) => ipcRenderer.invoke('api:startAnalysis', request),
  chatWithAI: (message, projectId) => ipcRenderer.invoke('ai:chat', message, projectId),
  setGitLabConfig: (config) => ipcRenderer.invoke('ai:setGitLabConfig', config),
  testGetCode: (params) => ipcRenderer.invoke('ai:testGetCode', params),
  onAIStream: (callback) => {
    const handler = (_: any, content: string) => callback(content);
    ipcRenderer.on('ai:stream', handler);
    return () => ipcRenderer.removeListener('ai:stream', handler);
  },
  onAnalysisStepUpdate: (callback) => {
    const handler = (_: any, stepData: AnalysisStepData) => callback(stepData);
    ipcRenderer.on('analysis:stepUpdate', handler);
    return () => ipcRenderer.removeListener('analysis:stepUpdate', handler);
  },
  onAnalysisStepComplete: (callback) => {
    const handler = (_: any, stepData: AnalysisStepData) => callback(stepData);
    ipcRenderer.on('analysis:stepComplete', handler);
    return () => ipcRenderer.removeListener('analysis:stepComplete', handler);
  },
  onAnalysisStepError: (callback) => {
    const handler = (_: any, stepData: AnalysisStepData) => callback(stepData);
    ipcRenderer.on('analysis:stepError', handler);
    return () => ipcRenderer.removeListener('analysis:stepError', handler);
  },
  onAnalysisStreamChunk: (callback) => {
    const handler = (_: any, content: string) => callback(content);
    ipcRenderer.on('analysis:streamChunk', handler);
    return () => ipcRenderer.removeListener('analysis:streamChunk', handler);
  },
  sendChatMessage: (projectId, message) => ipcRenderer.invoke('chat:sendMessage', projectId, message),
  onChatStreamChunk: (callback) => {
    const handler = (_: any, data: { projectId: string; chunk: string }) => callback(data);
    ipcRenderer.on('chat:streamChunk', handler);
    return () => ipcRenderer.removeListener('chat:streamChunk', handler);
  },
  testRedisConnection: (config) => ipcRenderer.invoke('redis:testConnection', config),
  getRedisTokens: (config, prefix) => ipcRenderer.invoke('redis:getTokens', config, prefix),
  getRedisFirstToken: (config, prefix) => ipcRenderer.invoke('redis:getFirstToken', config, prefix),
  getModuleVersions: (config) => ipcRenderer.invoke('api:getModuleVersions', config),
  getLogs: (config) => ipcRenderer.invoke('api:getLogs', config),
  getCodeRepositories: (projectId) => ipcRenderer.invoke('db:getCodeRepositories', projectId),
  getCodeRepositoryById: (id) => ipcRenderer.invoke('db:getCodeRepositoryById', id),
  createCodeRepository: (repo) => ipcRenderer.invoke('db:createCodeRepository', repo),
  updateCodeRepository: (id, updates) => ipcRenderer.invoke('db:updateCodeRepository', id, updates),
  deleteCodeRepository: (id) => ipcRenderer.invoke('db:deleteCodeRepository', id),
  createDefaultCodeRepositories: (projectId) => ipcRenderer.invoke('db:createDefaultCodeRepositories', projectId),
  matchCodeRepository: (projectId, serviceName, requestUrl) => ipcRenderer.invoke('db:matchCodeRepository', projectId, serviceName, requestUrl),
  inferBranchFromTag: (tag: string) => ipcRenderer.invoke('db:inferBranchFromTag', tag),
  getGlobalConfig: () => ipcRenderer.invoke('db:getGlobalConfig'),
  saveGlobalConfig: (config: any) => ipcRenderer.invoke('db:saveGlobalConfig', config),
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