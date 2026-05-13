import { ProgressCallback } from './oracle';
export interface TableColumn {
    columnName: string;
    dataType: string;
    nullable: string;
    dataDefault: string | null;
    comments: string;
    isPrimaryKey: boolean;
    hasData?: boolean;
    dataPercentage?: number;
    isUsed?: boolean;
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
    owner?: string;
}
export interface DamengConnectionParams {
    host: string;
    port: number;
    schema: string;
    username: string;
    password: string;
}
export declare function testDamengConnection(params: DamengConnectionParams): Promise<{
    success: boolean;
    message: string;
}>;
export declare function getDamengTables(params: DamengConnectionParams, onProgress?: ProgressCallback, tableNamePattern?: string, abortSignal?: AbortSignal, filterEmptyTables?: boolean): Promise<TableInfo[]>;
export declare function executeDamengQuery(params: DamengConnectionParams, sql: string): Promise<{
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number;
}>;
