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
    testConnection: (ds: any) => Promise<{
        success: boolean;
        message: string;
    }>;
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
    setGitLabConfig: (config: {
        baseUrl: string;
        token: string;
        defaultBranch?: string;
    }) => Promise<{
        success: boolean;
        message: string;
    }>;
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
        createDataSource: (ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & {
            password: string;
        }) => Promise<DataSourceRecord>;
        updateDataSource: (id: string, ds: Partial<DataSourceRecord>) => Promise<DataSourceRecord | undefined>;
        deleteDataSource: (id: string) => Promise<void>;
        getConfig: (projectId: string) => Promise<ProjectConfigRecord | undefined>;
        saveConfig: (config: Omit<ProjectConfigRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectConfigRecord>;
        testDataSourceConnection: (ds: any) => Promise<{
            success: boolean;
            message: string;
        }>;
        executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
    };
}
