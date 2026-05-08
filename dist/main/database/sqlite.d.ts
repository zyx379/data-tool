export interface DataSourceRecord {
    id: string;
    name: string;
    type: 'oracle' | 'dameng';
    host: string;
    port: number;
    sid?: string;
    serviceName?: string;
    schema?: string;
    username: string;
    password: string;
    isActive: number;
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
export declare function setActiveDataSource(id: string): void;
export declare function getActiveDataSource(): DataSourceRecord | undefined;
export declare function getQueryHistory(limit?: number): any[];
export declare function addQueryHistory(history: Omit<any, 'id'>): void;
export declare function clearQueryHistory(): void;
export declare const SCHEMA_CACHE_VERSION = "v2";
export declare function getSchemaCache(dataSourceId: string, filterPattern?: string, matchAnyFilter?: boolean): any | undefined;
export declare function setSchemaCache(dataSourceId: string, schemaData: any[], filterPattern?: string): {
    id: string;
    cachedAt: string;
};
export declare function clearSchemaCache(dataSourceId?: string): void;
export declare function cleanOldSchemaCache(keepDays?: number): void;
export declare function removeTableFromSchemaCache(dataSourceId: string, tableName: string): void;
export declare function removeTablesFromSchemaCache(dataSourceId: string, tableNames: string[]): void;
