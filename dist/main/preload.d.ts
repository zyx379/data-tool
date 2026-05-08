export interface SchemaProgress {
    current: number;
    total: number;
    currentTable: string;
    phase: 'loading' | 'processing' | 'complete' | 'error';
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
}
