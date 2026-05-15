export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
  detail?: string;
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

export interface AnalysisRequest {
  logId: string;
  description: string;
  projectId: string;
  projectName: string;
  aiModel?: string;
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

export interface AnalysisResult {
  success: boolean;
  message: string;
  conversation: any[];
  steps?: AnalysisStepData[];
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
  startAnalysis: (request: any) => Promise<AnalysisResult>;
  chatWithAI: (userMessage: string, dataSourceId: string) => Promise<AnalysisResult>;
  setGitLabConfig: (config: any) => Promise<{ success: boolean; message: string }>;
  testGetCode: (params: any) => Promise<any>;
  onAIStream: (callback: (content: string) => void) => () => void;
  onAnalysisStepUpdate: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStepComplete: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStepError: (callback: (stepData: AnalysisStepData) => void) => () => void;
  onAnalysisStreamChunk: (callback: (content: string) => void) => () => void;
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
    getAll: () => Promise<any[]>;
    getById: (id: string) => Promise<any>;
    create: (project: any) => Promise<any>;
    update: (id: string, project: any) => Promise<any>;
    delete: (id: string) => Promise<void>;
    setActive: (id: string) => Promise<void>;
    getActive: () => Promise<any>;
    getActiveWithDetails: () => Promise<any>;
    getDataSource: (projectId: string) => Promise<any>;
    createDataSource: (ds: any) => Promise<any>;
    updateDataSource: (id: string, ds: any) => Promise<any>;
    deleteDataSource: (id: string) => Promise<void>;
    getConfig: (projectId: string) => Promise<any>;
    saveConfig: (config: any) => Promise<any>;
    testDataSourceConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
    executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};