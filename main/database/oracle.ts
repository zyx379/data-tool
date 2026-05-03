import oracledb from 'oracledb';

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

export async function getOracleTables(params: OracleConnectionParams): Promise<TableInfo[]> {
  let connection: oracledb.Connection | null = null;
  const schema = params.schema || params.username.toUpperCase();

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
    
    console.log('Fetching ALL tables (all owners)...');
    const tablesResult = await connection.execute(`
      SELECT owner, table_name, NVL(comments, ' ') as table_comments
      FROM all_tab_comments
      WHERE table_type = 'TABLE'
      ORDER BY owner, table_name
    `);

    console.log(`Total tables found in DB: ${tablesResult.rows ? tablesResult.rows.length : 0}`);
    
    const tables: TableInfo[] = [];

    if (!tablesResult.rows) {
      console.log('No rows returned');
      return tables;
    }

    const tablesData = tablesResult.rows as any[];
    
    for (let i = 0; i < tablesData.length; i++) {
      const row = tablesData[i];
      const owner = row[0] as string;
      const tableName = row[1] as string;
      const tableComments = row[2] as string;

      if (i % 100 === 0) {
        console.log(`Processing table ${i + 1}/${tablesData.length}: ${owner}.${tableName}`);
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

      tables.push({
        tableName: `${owner}.${tableName}`,
        comments: tableComments,
        columns,
        indexes,
        owner,
      });
    }

    console.log(`Successfully loaded ${tables.length} tables`);
    await connection.close();
    return tables;
  } catch (error) {
    console.error('Error fetching Oracle tables:', error);
    if (connection) {
      try {
        await connection.close();
      } catch {}
    }
    throw error;
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
