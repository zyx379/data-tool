import { getDataSourceById } from '../../database/sqlite';
import { executeOracleQuery, OracleConnectionParams } from '../../database/oracle';
import { executeDamengQuery, DamengConnectionParams } from '../../database/dameng';
import { LogInfo, ToolResult } from '../types';

export async function queryLog(
  logId: string,
  dataSourceId: string,
  tableName: string = 'HIS_LOG'
): Promise<ToolResult> {
  try {
    const ds = getDataSourceById(dataSourceId);
    if (!ds) {
      return { success: false, error: '数据源不存在' };
    }

    let sql: string;
    if (ds.type === 'oracle') {
      sql = `SELECT * FROM ${tableName} WHERE LOG_ID = '${logId}'`;
    } else if (ds.type === 'dameng') {
      sql = `SELECT * FROM "${tableName}" WHERE LOG_ID = '${logId}'`;
    } else {
      return { success: false, error: '不支持的数据库类型' };
    }

    let result;
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
      result = await executeOracleQuery(params, sql);
    } else {
      const params: DamengConnectionParams = {
        host: ds.host,
        port: ds.port,
        schema: ds.schema || ds.username,
        username: ds.username,
        password: ds.password,
      };
      result = await executeDamengQuery(params, sql);
    }

    if (result.rows.length === 0) {
      return { success: false, error: `未找到日志ID: ${logId}` };
    }

    const columns = result.columns;
    const row = result.rows[0];
    
    const logInfo: LogInfo = {
      logId: logId,
      content: '',
    };

    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i].toUpperCase();
      const value = row[i];
      
      if (colName === 'LOG_ID') {
        logInfo.logId = String(value || '');
      } else if (colName === 'CONTENT' || colName === 'LOG_CONTENT' || colName === 'MESSAGE') {
        logInfo.content = String(value || '');
      } else if (colName === 'SERVICE_NAME' || colName === 'SERVICENAME') {
        logInfo.serviceName = String(value || '');
      } else if (colName === 'PAGE_PATH' || colName === 'PAGEPATH' || colName === 'PAGE') {
        logInfo.pagePath = String(value || '');
      } else if (colName === 'ERROR_MESSAGE' || colName === 'ERRORMESSAGE' || colName === 'ERROR') {
        logInfo.errorMessage = String(value || '');
      } else if (colName === 'TIMESTAMP' || colName === 'CREATE_TIME' || colName === 'CREATETIME') {
        logInfo.timestamp = String(value || '');
      } else {
        logInfo[colName] = value;
      }
    }

    if (!logInfo.content && Object.keys(logInfo).length > 1) {
      logInfo.content = JSON.stringify(logInfo, null, 2);
    }

    return { success: true, data: logInfo };
  } catch (error) {
    console.error('Query log error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildLogQueryPrompt(logId: string, logInfo: LogInfo): string {
  let prompt = `## 日志查询结果\n\n`;
  prompt += `**日志ID**: ${logInfo.logId}\n\n`;
  
  if (logInfo.serviceName) {
    prompt += `**服务名称**: ${logInfo.serviceName}\n`;
  }
  if (logInfo.pagePath) {
    prompt += `**页面路径**: ${logInfo.pagePath}\n`;
  }
  if (logInfo.errorMessage) {
    prompt += `**错误信息**: ${logInfo.errorMessage}\n`;
  }
  if (logInfo.timestamp) {
    prompt += `**时间戳**: ${logInfo.timestamp}\n`;
  }
  
  prompt += `\n**日志内容**:\n\`\`\`\n${logInfo.content}\n\`\`\`\n\n`;
  
  prompt += `请分析以上日志内容，提取关键信息：\n`;
  prompt += `1. 错误类型和错误码\n`;
  prompt += `2. 相关的业务模块\n`;
  prompt += `3. 可能的根本原因\n`;
  prompt += `4. 建议的后续操作\n`;

  return prompt;
}
