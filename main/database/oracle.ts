import oracledb from 'oracledb';

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

function buildConnectionString(params: OracleConnectionParams): string {
  if (params.serviceName) {
    return `${params.host}:${params.port}/${params.serviceName}`;
  } else if (params.sid) {
    return `${params.host}:${params.port}:${params.sid}`;
  }
  throw new Error('必须提供 serviceName 或 sid');
}

export async function testOracleConnection(params: OracleConnectionParams): Promise<{ success: boolean; message: string }> {
  let connection: oracledb.Connection | null = null;
  try {
    const connectionString = buildConnectionString(params);
    connection = await oracledb.getConnection({
      user: params.username,
      password: params.password,
      connectString: connectionString,
    });
    await connection.close();
    return { success: true, message: 'Oracle 连接成功' };
  } catch (error) {
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
    return { success: false, message: (error as Error).message };
  }
}

export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
}

export type ProgressCallback = (progress: SchemaProgress) => void;

function escapeOracleRegex(pattern: string): string {
  const specialChars = /([$()|\\])/g;
  return pattern.replace(specialChars, '\\$1');
}

export async function getOracleTables(
  params: OracleConnectionParams,
  onProgress?: ProgressCallback,
  ownerFilter?: string,
  tableNamePattern?: string
): Promise<TableInfo[]> {
  let connection: oracledb.Connection | null = null;
  const schema = params.schema || params.username.toUpperCase();

  const reportProgress = (current: number, total: number, currentTable: string, phase: SchemaProgress['phase']) => {
    if (onProgress) {
      onProgress({ current, total, currentTable, phase });
    }
  };

  try {
    const connectionString = buildConnectionString(params);
    connection = await oracledb.getConnection({
      user: params.username,
      password: params.password,
      connectString: connectionString,
    });

    console.log('=== DIAGNOSIS INFO ===');
    console.log('Connecting with schema:', schema);
    console.log('Username:', params.username);
    console.log('ownerFilter (in getOracleTables):', ownerFilter);
    console.log('tableNamePattern (in getOracleTables):', tableNamePattern);

    const hasOwnerFilter = ownerFilter && ownerFilter.trim();
    const hasTableNamePattern = tableNamePattern && tableNamePattern.trim();
    
    let filterDesc = '(all tables)';
    if (hasOwnerFilter && hasTableNamePattern) {
      filterDesc = `owner: ${ownerFilter}, pattern: ${tableNamePattern}`;
    } else if (hasOwnerFilter) {
      filterDesc = `owner: ${ownerFilter}`;
    } else if (hasTableNamePattern) {
      filterDesc = `pattern: ${tableNamePattern}`;
    }
    
    console.log(`Fetching tables: ${filterDesc}`);
    reportProgress(0, 0, `正在获取表列表... (${filterDesc})`, 'loading');
    
    let query = `
      SELECT owner, table_name, NVL(comments, ' ') as table_comments
      FROM all_tab_comments
      WHERE table_type = 'TABLE'
    `;
    
    if (hasOwnerFilter) {
      query += ` AND owner = '${ownerFilter.toUpperCase()}'`;
    }
    
    if (hasTableNamePattern) {
      try {
        const regex = new RegExp(tableNamePattern, 'i');
        const escapedPattern = escapeOracleRegex(tableNamePattern);
        console.log('Original pattern:', tableNamePattern);
        console.log('Escaped pattern:', escapedPattern);
        console.log('Adding REGEXP_LIKE condition for both owner and table_name');
        query += ` AND (REGEXP_LIKE(table_name, '${escapedPattern}', 'i') OR REGEXP_LIKE(owner, '${escapedPattern}', 'i'))`;
      } catch (e) {
        console.log('Invalid regex pattern, skipping table name filter:', e);
      }
    }
    
    console.log('Final query:', query);
    
    query += ' ORDER BY owner, table_name';
    
    const tablesResult = await connection.execute(query);

    console.log(`Total tables found in DB: ${tablesResult.rows ? tablesResult.rows.length : 0}`);

    const tables: TableInfo[] = [];

    if (!tablesResult.rows) {
      console.log('No rows returned');
      reportProgress(0, 0, '没有找到表', 'complete');
      return tables;
    }

    const tablesData = tablesResult.rows as any[];
    const totalTables = tablesData.length;

    reportProgress(0, totalTables, '开始加载表结构...', 'processing');

    for (let i = 0; i < tablesData.length; i++) {
      const row = tablesData[i];
      const owner = row[0] as string;
      const tableName = row[1] as string;
      const tableComments = row[2] as string;
      const fullTableName = `${owner}.${tableName}`;

      if (i % 10 === 0 || i === tablesData.length - 1) {
        console.log(`Processing table ${i + 1}/${tablesData.length}: ${fullTableName}`);
        reportProgress(i + 1, totalTables, fullTableName, 'processing');
      }

      const columnsResult = await connection.execute(`
        SELECT
          col2.column_name,
          col2.data_type,
          col2.nullable,
          col2.data_default,
          NVL(col.comments, ' ') as column_comments
        FROM all_tab_columns col2
        LEFT JOIN all_col_comments col ON col2.owner = col.owner AND col2.table_name = col.table_name AND col2.column_name = col.column_name
        WHERE col2.owner = :owner AND col2.table_name = :tableName
        ORDER BY col2.column_id
      `, [owner, tableName]);

      const columns: TableColumn[] = [];
      const primaryKeys: Set<string> = new Set();

      const pkResult = await connection.execute(`
        SELECT col.column_name
        FROM all_constraints con
        JOIN all_cons_columns col ON con.owner = col.owner AND con.constraint_name = col.constraint_name
        WHERE con.owner = :owner AND con.table_name = :tableName AND con.constraint_type = 'P'
      `, [owner, tableName]);

      for (const pkRow of pkResult.rows as any[]) {
        primaryKeys.add(pkRow[0] as string);
      }

      for (const colRow of columnsResult.rows as any[]) {
        columns.push({
          columnName: colRow[0] as string,
          dataType: colRow[1] as string,
          nullable: colRow[2] as string,
          dataDefault: colRow[3] as string | null,
          comments: colRow[4] as string,
          isPrimaryKey: primaryKeys.has(colRow[0] as string),
        });
      }

      const indexesResult = await connection.execute(`
        SELECT
          ind.index_name,
          col.column_name,
          ind.index_type,
          ind.uniqueness
        FROM all_indexes ind
        JOIN all_ind_columns col ON ind.owner = col.index_owner AND ind.index_name = col.index_name
        WHERE ind.owner = :owner AND ind.table_name = :tableName AND ind.index_type != 'LOB'
      `, [owner, tableName]);

      const indexes: TableIndex[] = [];
      for (const idxRow of indexesResult.rows as any[]) {
        indexes.push({
          indexName: idxRow[0] as string,
          columnName: idxRow[1] as string,
          indexType: idxRow[2] as string,
          uniqueness: idxRow[3] as string,
        });
      }

      const dataResult = await checkColumnData(connection, owner, tableName, columns);
      for (let j = 0; j < columns.length; j++) {
        columns[j].hasData = dataResult[j]?.hasData || false;
        columns[j].dataPercentage = dataResult[j]?.percentage || 0;
        if (dataResult[j]?.hasData && !columns[j].isPrimaryKey) {
          columns[j].isUsed = true;
        }
      }

      tables.push({
        tableName: fullTableName,
        comments: tableComments,
        columns,
        indexes,
        owner,
      });
    }

    console.log(`Successfully loaded ${tables.length} tables`);
    reportProgress(totalTables, totalTables, `加载完成 (${tables.length} 个表)`, 'complete');
    await connection.close();
    return tables;
  } catch (error) {
    console.error('Error fetching Oracle tables:', error);
    reportProgress(0, 0, `错误: ${(error as Error).message}`, 'error');
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
    throw error;
  }
}



const SAMPLE_SIZE = 1000;

async function checkColumnData(
  connection: oracledb.Connection,
  owner: string,
  tableName: string,
  columns: TableColumn[]
): Promise<{ hasData: boolean; percentage: number }[]> {
  console.log('[checkColumnData] START:', owner, tableName, 'columns:', columns.length);
  try {
    const columnNames = columns.map(c => '"' + c.columnName + '"').join(', ');

    const sql = 'SELECT ' + columnNames + ' FROM "' + owner + '"."' + tableName + '" FETCH FIRST ' + SAMPLE_SIZE + ' ROWS ONLY';

    const result = await connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });

    const rows = (result.rows || []) as any[][];
    const totalRows = rows.length;

    if (totalRows === 0) {
      console.log('[checkColumnData] No rows for', owner, tableName);
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

    console.log('[checkColumnData] DONE:', owner, tableName, 'results:', columnResults.filter(r => r.hasData).length, 'columns with data');
    return columnResults;
  } catch (error) {
    console.warn('[checkColumnData] ERROR:', owner, tableName, error);
    return columns.map(() => ({ hasData: false, percentage: 0 }));
  }
}
export async function executeOracleQuery(
  params: OracleConnectionParams,
  sql: string
): Promise<{ columns: string[]; rows: any[][]; rowCount: number; executionTime: number }> {
  let connection: oracledb.Connection | null = null;
  const startTime = Date.now();

  try {
    const connectionString = buildConnectionString(params);
    connection = await oracledb.getConnection({
      user: params.username,
      password: params.password,
      connectString: connectionString,
    });

    const result = await connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });

    const executionTime = Date.now() - startTime;
    const columns = (result.metaData || []).map((col: any) => col.name);
    const rows = (result.rows || []) as any[][];
    const rowCount = rows.length;

    await connection.close();
    return { columns, rows, rowCount, executionTime };
  } catch (error) {
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
    throw error;
  }
}
