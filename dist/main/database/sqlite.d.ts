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
export interface ProjectRecord {
    id: string;
    name: string;
    description?: string;
    isActive: number;
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
export declare function initDatabase(): Promise<void>;
export declare function closeDatabase(): void;
export declare function encryptPassword(password: string): string;
export declare function decryptPassword(encrypted: string): string;
export declare function getAllDataSources(): DataSourceRecord[];
export declare function getDataSourceById(id: string): DataSourceRecord | undefined;
export declare function createDataSource(ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & {
    password: string;
}): DataSourceRecord;
export declare function updateDataSource(id: string, ds: Partial<DataSourceRecord>): DataSourceRecord | undefined;
export declare function deleteDataSource(id: string): void;
export declare function getDataSourceByProjectId(projectId: string): DataSourceRecord | undefined;
export declare function getActiveDataSource(): DataSourceRecord | undefined;
export declare function getQueryHistory(limit?: number): any[];
export declare function addQueryHistory(history: Omit<any, 'id'>): void;
export declare function clearQueryHistory(): void;
export declare function getSchemaCache(dataSourceId: string, filterPattern?: string, matchAnyFilter?: boolean): any | undefined;
export declare function setSchemaCache(dataSourceId: string, schemaData: any[], filterPattern?: string): {
    id: string;
    cachedAt: string;
};
export declare function clearSchemaCache(dataSourceId?: string): void;
export declare function cleanOldSchemaCache(keepDays?: number): void;
export declare function removeTableFromSchemaCache(dataSourceId: string, tableName: string): void;
export declare function removeTablesFromSchemaCache(dataSourceId: string, tableNames: string[]): void;
export declare function getAllProjects(): ProjectRecord[];
export declare function getProjectById(id: string): ProjectRecord | undefined;
export declare function createProject(project: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): ProjectRecord;
export declare function updateProject(id: string, updates: Partial<ProjectRecord>): ProjectRecord | undefined;
export declare function deleteProject(id: string): void;
export declare function setActiveProject(id: string): void;
export declare function getActiveProject(): ProjectRecord | undefined;
export declare function getProjectDataSources(projectId: string): DataSourceRecord | undefined;
export declare function getProjectDataSourceById(id: string): DataSourceRecord | undefined;
export declare function createProjectDataSource(ds: Omit<DataSourceRecord, 'id' | 'createdAt' | 'updatedAt' | 'password'> & {
    password: string;
}): DataSourceRecord;
export declare function updateProjectDataSource(id: string, ds: Partial<DataSourceRecord>): DataSourceRecord | undefined;
export declare function deleteProjectDataSource(id: string): void;
export declare function getProjectConfig(projectId: string): ProjectConfigRecord | undefined;
export declare function createOrUpdateProjectConfig(config: Omit<ProjectConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): ProjectConfigRecord;
export declare function deleteProjectConfig(projectId: string): void;
export declare function getActiveProjectWithDetails(): {
    project: ProjectRecord | undefined;
    dataSource: DataSourceRecord | undefined;
    config: ProjectConfigRecord | undefined;
};
