import { SchemaProgress, ProgressCallback } from './oracle';

function escapeOracleRegex(pattern: string): string {
  const specialChars = /([$()|\\])/g;
  return pattern.replace(specialChars, '\\$1');
}

export interface TableColumn {
  columnName: string;
  dataType: string;
  nullable: string;
  dataDefault: string | null;
  comments: string;
  isPrimaryKey: boolean;
  hasData?: boolean;
  dataPercentage?: number;
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

export async function testDamengConnection(params: DamengConnectionParams): Promise<{ success: boolean; message: string }> {
  try {
    const Connection = require('dmdb');
    const conn = new Connection({
      host: params.host,
      port: params.port,
      dba_user: params.username,
      dba_password: params.password,
      database: params.schema,
    });
    conn.close();
    return { success: true, message: '达梦连接成功' };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

export async function getDamengTables(
  params: DamengConnectionParams,
  onProgress?: ProgressCallback,
  tableNamePattern?: string
): Promise<TableInfo[]> {
  const Connection = require('dmdb');
  const conn = new Connection({
    host: params.host,
    port: params.port,
    dba_user: params.username,
    dba_password: params.password,
    database: params.schema,
  });

  const reportProgress = (current: number, total: number, currentTable: string, phase: SchemaProgress['phase']) => {
    if (onProgress) {
      onProgress({ current, total, currentTable, phase });
    }
  };

  try {
    console.log('tableNamePattern (in getDamengTables):', tableNamePattern);
    const hasTableNamePattern = tableNamePattern && tableNamePattern.trim();
    
    let filterDesc = '(all tables)';
    if (hasTableNamePattern) {
      filterDesc = `pattern: ${tableNamePattern}`;
    }
    
    console.log(`Fetching tables: ${filterDesc}`);
    reportProgress(0, 0, `正在获取表列表... (${filterDesc})`, 'loading');
    
    let query = `
      SELECT TABLE_NAME
      FROM USER_TABLES
    `;
    
    if (hasTableNamePattern) {
      try {
        const regex = new RegExp(tableNamePattern, 'i');
        query += ` WHERE REGEXP_LIKE(TABLE_NAME, '${escapeOracleRegex(tableNamePattern)}', 'i')`;
      } catch {
        console.log('Invalid regex pattern, skipping table name filter');
      }
    }
    
    query += ' ORDER BY TABLE_NAME';
    
    const tablesResult = conn.execute(query);

    const tables: TableInfo[] = [];
    const tablesData = tablesResult.rows || [];
    const totalTables = tablesData.length;

    if (totalTables === 0) {
      reportProgress(0, 0, '没有找到表', 'complete');
      conn.close();
      return [];
    }

    reportProgress(0, totalTables, '开始加载表结构...', 'processing');

    for (let i = 0; i < tablesData.length; i++) {
      const row = tablesData[i];
      const tableName = row[0] as string;

      if (i % 10 === 0 || i === tablesData.length - 1) {
        reportProgress(i + 1, totalTables, tableName, 'processing');
      }

      const columnsResult = conn.execute(`
        SELECT
          col.COLUMN_NAME,
          col.DATA_TYPE,
          col.NULLABLE,
          col.DATA_DEFAULT,
          com.COMMENTS
        FROM USER_TAB_COLUMNS col
        LEFT JOIN USER_COL_COMMENTS com ON col.TABLE_NAME = com.TABLE_NAME AND col.COLUMN_NAME = com.COLUMN_NAME
        WHERE col.TABLE_NAME = '${tableName}'
        ORDER BY col.COLUMN_ID
      `);

      const columns: TableColumn[] = [];
      const primaryKeys: Set<string> = new Set();

      const pkResult = conn.execute(`
        SELECT col.column_name
        FROM USER_constraints con
        JOIN USER_cons_columns col ON con.constraint_name = col.constraint_name
        WHERE con.constraint_type = 'P' AND con.table_name = '${tableName}'
      `);

      for (const pkRow of pkResult.rows || []) {
        primaryKeys.add(pkRow[0] as string);
      }

      for (const colRow of columnsResult.rows || []) {
        columns.push({
          columnName: colRow[0] as string,
          dataType: colRow[1] as string,
          nullable: colRow[2] as string,
          dataDefault: colRow[3] as string | null,
          comments: (colRow[4] as string) || '',
          isPrimaryKey: primaryKeys.has(colRow[0] as string),
        });
      }

      const indexesResult = conn.execute(`
        SELECT
          ind.INDEX_NAME,
          indc.COLUMN_NAME,
          ind.INDEX_TYPE,
          ind.UNIQUENESS
        FROM USER_INDEXES ind
        JOIN USER_IND_COLUMNS indc ON ind.INDEX_NAME = indc.INDEX_NAME
        WHERE ind.TABLE_NAME = '${tableName}' AND ind.INDEX_TYPE != 'LOB'
      `);

      const indexes: TableIndex[] = [];
      for (const idxRow of indexesResult.rows || []) {
        indexes.push({
          indexName: idxRow[0] as string,
          columnName: idxRow[1] as string,
          indexType: idxRow[2] as string,
          uniqueness: idxRow[3] as string,
        });
      }

      const commentsResult = conn.execute(`
        SELECT COMMENTS FROM USER_TAB_COMMENTS WHERE TABLE_NAME = '${tableName}'
      `);
      const tableComments = (commentsResult.rows && commentsResult.rows[0] && commentsResult.rows[0][0]) || '';

      const dataResult = checkDamengColumnData(conn, tableName, columns);
      for (let j = 0; j < columns.length; j++) {
        columns[j].hasData = dataResult[j]?.hasData || false;
        columns[j].dataPercentage = dataResult[j]?.percentage || 0;
      }

      tables.push({
        tableName,
        comments: tableComments as string,
        columns,
        indexes,
        owner: params.schema.toUpperCase(),
      });
    }

    reportProgress(totalTables, totalTables, `加载完成 (${tables.length} 个表)`, 'complete');
    conn.close();
    return tables;
  } catch (error) {
    reportProgress(0, 0, `错误: ${(error as Error).message}`, 'error');
    conn.close();
    throw error;
  }
}

export async function executeDamengQuery(
  params: DamengConnectionParams,
  sql: string
): Promise<{ columns: string[]; rows: any[][]; rowCount: number; executionTime: number }> {
  const Connection = require('dmdb');
  const conn = new Connection({
    host: params.host,
    port: params.port,
    dba_user: params.username,
    dba_password: params.password,
    database: params.schema,
  });

  const startTime = Date.now();

  try {
    const result = conn.execute(sql);
    const executionTime = Date.now() - startTime;

    const columns = result.metaData ? result.metaData.map((col: any) => col.name) : [];
    const rows = result.rows || [];
    const rowCount = rows.length;

    conn.close();
    return { columns, rows, rowCount, executionTime };
  } catch (error) {
    conn.close();
    throw error;
  }
}

const SAMPLE_SIZE = 1000;

function checkDamengColumnData(
  conn: any,
  tableName: string,
  columns: TableColumn[]
): { hasData: boolean; percentage: number }[] {
  try {
    const columnNames = columns.map(c => `"${c.columnName}"`).join(', ');
    
    const sql = `
      SELECT TOP ${SAMPLE_SIZE} ${columnNames}
      FROM "${tableName}"
    `;

    const result = conn.execute(sql);
    const rows = (result.rows || []) as any[][];
    const totalRows = rows.length;

    if (totalRows === 0) {
      return columns.map(() => ({ hasData: false, percentage: 0 }));
    }

    const columnResults: { hasData: boolean; percentage: number }[] = [];

    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      let nonNullCount = 0;
      
      for (const row of rows) {
        if (row[colIndex] !== null && row[colIndex] !== undefined) {
          nonNullCount++;
        }
      }

      const percentage = Math.round((nonNullCount / totalRows) * 100);
      columnResults.push({
        hasData: nonNullCount > 0,
        percentage,
      });
    }

    return columnResults;
  } catch (error) {
    console.warn(`Error checking column data for ${tableName}:`, error);
    return columns.map(() => ({ hasData: false, percentage: 0 }));
  }
}
