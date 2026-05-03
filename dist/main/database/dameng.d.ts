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
export declare function getDamengTables(params: DamengConnectionParams): Promise<TableInfo[]>;
export declare function executeDamengQuery(params: DamengConnectionParams, sql: string): Promise<{
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number;
}>;
