export interface TableColumn {
    columnName: string;
    dataType: string;
    nullable: string;
    dataDefault: string | null;
    comments: string;
    isPrimaryKey: boolean;
}
export interface TableIndex {
    indexName: string;
    columnName: string;
    indexType: string;
    uniqueness: string;
}
export interface TableInfo {
    tableName: string;
    comments: string;
    columns: TableColumn[];
    indexes: TableIndex[];
    owner: string;
}
export interface OracleConnectionParams {
    host: string;
    port: number;
    serviceName?: string;
    sid?: string;
    username: string;
    password: string;
    schema?: string;
}
export declare function testOracleConnection(params: OracleConnectionParams): Promise<{
    success: boolean;
    message: string;
}>;
export interface SchemaProgress {
    current: number;
    total: number;
    currentTable: string;
    phase: 'loading' | 'processing' | 'complete' | 'error';
}
export type ProgressCallback = (progress: SchemaProgress) => void;
export declare function getOracleTables(params: OracleConnectionParams, onProgress?: ProgressCallback, ownerFilter?: string, tableNamePattern?: string): Promise<TableInfo[]>;
export declare function executeOracleQuery(params: OracleConnectionParams, sql: string): Promise<{
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number;
}>;
