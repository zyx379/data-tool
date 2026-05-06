"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testOracleConnection = testOracleConnection;
exports.getOracleTables = getOracleTables;
exports.executeOracleQuery = executeOracleQuery;
const oracledb_1 = __importDefault(require("oracledb"));
function buildConnectionString(params) {
    if (params.serviceName) {
        return `${params.host}:${params.port}/${params.serviceName}`;
    }
    else if (params.sid) {
        return `${params.host}:${params.port}:${params.sid}`;
    }
    throw new Error('必须提供 serviceName 或 sid');
}
async function testOracleConnection(params) {
    let connection = null;
    try {
        const connectionString = buildConnectionString(params);
        connection = await oracledb_1.default.getConnection({
            user: params.username,
            password: params.password,
            connectString: connectionString,
        });
        await connection.close();
        return { success: true, message: 'Oracle 连接成功' };
    }
    catch (error) {
        if (connection) {
            try {
                await connection.close();
            }
            catch { }
        }
        return { success: false, message: error.message };
    }
}
function escapeOracleRegex(pattern) {
    const specialChars = /([$()|\\])/g;
    return pattern.replace(specialChars, '\\$1');
}
async function getOracleTables(params, onProgress, ownerFilter, tableNamePattern) {
    let connection = null;
    const schema = params.schema || params.username.toUpperCase();
    const reportProgress = (current, total, currentTable, phase) => {
        if (onProgress) {
            onProgress({ current, total, currentTable, phase });
        }
    };
    try {
        const connectionString = buildConnectionString(params);
        connection = await oracledb_1.default.getConnection({
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
        }
        else if (hasOwnerFilter) {
            filterDesc = `owner: ${ownerFilter}`;
        }
        else if (hasTableNamePattern) {
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
            }
            catch (e) {
                console.log('Invalid regex pattern, skipping table name filter:', e);
            }
        }
        console.log('Final query:', query);
        query += ' ORDER BY owner, table_name';
        const tablesResult = await connection.execute(query);
        console.log(`Total tables found in DB: ${tablesResult.rows ? tablesResult.rows.length : 0}`);
        const tables = [];
        if (!tablesResult.rows) {
            console.log('No rows returned');
            reportProgress(0, 0, '没有找到表', 'complete');
            return tables;
        }
        const tablesData = tablesResult.rows;
        const totalTables = tablesData.length;
        reportProgress(0, totalTables, '开始加载表结构...', 'processing');
        for (let i = 0; i < tablesData.length; i++) {
            const row = tablesData[i];
            const owner = row[0];
            const tableName = row[1];
            const tableComments = row[2];
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
            const columns = [];
            const primaryKeys = new Set();
            const pkResult = await connection.execute(`
        SELECT col.column_name
        FROM all_constraints con
        JOIN all_cons_columns col ON con.owner = col.owner AND con.constraint_name = col.constraint_name
        WHERE con.owner = :owner AND con.table_name = :tableName AND con.constraint_type = 'P'
      `, [owner, tableName]);
            for (const pkRow of pkResult.rows) {
                primaryKeys.add(pkRow[0]);
            }
            for (const colRow of columnsResult.rows) {
                columns.push({
                    columnName: colRow[0],
                    dataType: colRow[1],
                    nullable: colRow[2],
                    dataDefault: colRow[3],
                    comments: colRow[4],
                    isPrimaryKey: primaryKeys.has(colRow[0]),
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
            const indexes = [];
            for (const idxRow of indexesResult.rows) {
                indexes.push({
                    indexName: idxRow[0],
                    columnName: idxRow[1],
                    indexType: idxRow[2],
                    uniqueness: idxRow[3],
                });
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
    }
    catch (error) {
        console.error('Error fetching Oracle tables:', error);
        reportProgress(0, 0, `错误: ${error.message}`, 'error');
        if (connection) {
            try {
                await connection.close();
            }
            catch { }
        }
        throw error;
    }
}
async function executeOracleQuery(params, sql) {
    let connection = null;
    const startTime = Date.now();
    try {
        const connectionString = buildConnectionString(params);
        connection = await oracledb_1.default.getConnection({
            user: params.username,
            password: params.password,
            connectString: connectionString,
        });
        const result = await connection.execute(sql, [], {
            outFormat: oracledb_1.default.OUT_FORMAT_ARRAY,
        });
        const executionTime = Date.now() - startTime;
        const columns = (result.metaData || []).map((col) => col.name);
        const rows = (result.rows || []);
        const rowCount = rows.length;
        await connection.close();
        return { columns, rows, rowCount, executionTime };
    }
    catch (error) {
        if (connection) {
            try {
                await connection.close();
            }
            catch { }
        }
        throw error;
    }
}
