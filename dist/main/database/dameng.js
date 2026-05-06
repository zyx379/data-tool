"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDamengConnection = testDamengConnection;
exports.getDamengTables = getDamengTables;
exports.executeDamengQuery = executeDamengQuery;
function escapeOracleRegex(pattern) {
    const specialChars = /([$()|\\])/g;
    return pattern.replace(specialChars, '\\$1');
}
async function testDamengConnection(params) {
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
    }
    catch (error) {
        return { success: false, message: error.message };
    }
}
async function getDamengTables(params, onProgress, tableNamePattern) {
    const Connection = require('dmdb');
    const conn = new Connection({
        host: params.host,
        port: params.port,
        dba_user: params.username,
        dba_password: params.password,
        database: params.schema,
    });
    const reportProgress = (current, total, currentTable, phase) => {
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
            }
            catch {
                console.log('Invalid regex pattern, skipping table name filter');
            }
        }
        query += ' ORDER BY TABLE_NAME';
        const tablesResult = conn.execute(query);
        const tables = [];
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
            const tableName = row[0];
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
            const columns = [];
            const primaryKeys = new Set();
            const pkResult = conn.execute(`
        SELECT col.column_name
        FROM USER_constraints con
        JOIN USER_cons_columns col ON con.constraint_name = col.constraint_name
        WHERE con.constraint_type = 'P' AND con.table_name = '${tableName}'
      `);
            for (const pkRow of pkResult.rows || []) {
                primaryKeys.add(pkRow[0]);
            }
            for (const colRow of columnsResult.rows || []) {
                columns.push({
                    columnName: colRow[0],
                    dataType: colRow[1],
                    nullable: colRow[2],
                    dataDefault: colRow[3],
                    comments: colRow[4] || '',
                    isPrimaryKey: primaryKeys.has(colRow[0]),
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
            const indexes = [];
            for (const idxRow of indexesResult.rows || []) {
                indexes.push({
                    indexName: idxRow[0],
                    columnName: idxRow[1],
                    indexType: idxRow[2],
                    uniqueness: idxRow[3],
                });
            }
            const commentsResult = conn.execute(`
        SELECT COMMENTS FROM USER_TAB_COMMENTS WHERE TABLE_NAME = '${tableName}'
      `);
            const tableComments = (commentsResult.rows && commentsResult.rows[0] && commentsResult.rows[0][0]) || '';
            tables.push({
                tableName,
                comments: tableComments,
                columns,
                indexes,
                owner: params.schema.toUpperCase(),
            });
        }
        reportProgress(totalTables, totalTables, `加载完成 (${tables.length} 个表)`, 'complete');
        conn.close();
        return tables;
    }
    catch (error) {
        reportProgress(0, 0, `错误: ${error.message}`, 'error');
        conn.close();
        throw error;
    }
}
async function executeDamengQuery(params, sql) {
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
        const columns = result.metaData ? result.metaData.map((col) => col.name) : [];
        const rows = result.rows || [];
        const rowCount = rows.length;
        conn.close();
        return { columns, rows, rowCount, executionTime };
    }
    catch (error) {
        conn.close();
        throw error;
    }
}
