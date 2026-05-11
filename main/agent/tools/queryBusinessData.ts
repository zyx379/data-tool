import { getDataSourceById } from '../../database/sqlite';
import { executeOracleQuery, OracleConnectionParams } from '../../database/oracle';
import { executeDamengQuery, DamengConnectionParams } from '../../database/dameng';
import { QueryResult, ToolResult } from '../types';

const MAX_ROWS = 100;

export async function queryBusinessData(
  sql: string,
  dataSourceId: string,
  description?: string
): Promise<ToolResult> {
  try {
    const ds = getDataSourceById(dataSourceId);
    if (!ds) {
      return { success: false, error: '数据源不存在' };
    }

    const trimmedSql = sql.trim().toUpperCase();
    
    if (!trimmedSql.startsWith('SELECT')) {
      return { 
        success: false, 
        error: '只允许执行 SELECT 查询语句' 
      };
    }

    let limitedSql = sql;
    if (ds.type === 'oracle') {
      limitedSql = `SELECT * FROM (${sql}) WHERE ROWNUM <= ${MAX_ROWS}`;
    } else if (ds.type === 'dameng') {
      limitedSql = `SELECT TOP ${MAX_ROWS} * FROM (${sql})`;
    }

    let result: QueryResult;
    
    if (ds.type === 'oracle') {
      const params: OracleConnectionParams = {
        host: ds.host,
        port: ds.port,
        serviceName: ds.serviceName,
        sid: ds.sid,
        username: ds.username,
        password: ds.password,
        schema: ds.schema,
      };
      result = await executeOracleQuery(params, limitedSql);
    } else if (ds.type === 'dameng') {
      const params: DamengConnectionParams = {
        host: ds.host,
        port: ds.port,
        schema: ds.schema || ds.username,
        username: ds.username,
        password: ds.password,
      };
      result = await executeDamengQuery(params, limitedSql);
    } else {
      return { success: false, error: '不支持的数据库类型' };
    }

    const queryResult = {
      description: description || '业务数据查询',
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      limited: result.rowCount >= MAX_ROWS,
      maxRows: MAX_ROWS,
    };

    return { success: true, data: queryResult };
  } catch (error) {
    console.error('Query business data error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildDataQueryPrompt(queryResult: any): string {
  let prompt = `## 业务数据查询结果\n\n`;
  
  if (queryResult.description) {
    prompt += `**查询目的**: ${queryResult.description}\n`;
  }
  
  prompt += `**执行时间**: ${queryResult.executionTime}ms\n`;
  prompt += `**返回行数**: ${queryResult.rowCount} 行\n`;
  
  if (queryResult.limited) {
    prompt += `**注意**: 结果已限制为前 ${queryResult.maxRows} 行\n`;
  }
  
  prompt += `\n**查询结果**:\n\n`;

  if (queryResult.rows.length === 0) {
    prompt += `查询返回 0 条记录\n`;
  } else {
    prompt += `| ${queryResult.columns.join(' | ')} |\n`;
    prompt += `| ${queryResult.columns.map(() => '---').join(' | ')} |\n`;
    
    const displayRows = queryResult.rows.slice(0, 10);
    displayRows.forEach((row: any[]) => {
      const formattedRow = row.map((cell: any) => {
        if (cell === null || cell === undefined) return 'NULL';
        const str = String(cell);
        if (str.length > 50) return str.substring(0, 47) + '...';
        return str;
      });
      prompt += `| ${formattedRow.join(' | ')} |\n`;
    });
    
    if (queryResult.rows.length > 10) {
      prompt += `\n*...还有 ${queryResult.rows.length - 10} 行数据未显示*\n`;
    }
  }

  prompt += `\n请分析以上数据，说明：\n`;
  prompt += `1. 数据的主要特征\n`;
  prompt += `2. 与问题的关联性\n`;
  prompt += `3. 可能的业务问题原因\n`;

  return prompt;
}

export function suggestCommonQueries(context: string): string[] {
  const suggestions: string[] = [];
  
  if (context.includes('患者') || context.includes('patient')) {
    suggestions.push('SELECT * FROM PATIENT_INFO WHERE PATIENT_ID = ?');
  }
  
  if (context.includes('订单') || context.includes('收费') || context.includes('charge')) {
    suggestions.push('SELECT * FROM CHARGE_ORDER WHERE ORDER_STATUS = ?');
  }
  
  if (context.includes('药品') || context.includes('药')) {
    suggestions.push('SELECT * FROM DRUG_INFO WHERE DRUG_CODE = ?');
  }
  
  return suggestions;
}
