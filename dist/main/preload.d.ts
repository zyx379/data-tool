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
    getSchema: (dataSourceId: string) => Promise<any[]>;
    executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
}
