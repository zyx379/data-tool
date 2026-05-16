import { queryLog, buildLogQueryPrompt } from './queryLog';
import { getCode, buildCodeQueryPrompt } from './gitLab';
import { queryBusinessData, buildDataQueryPrompt } from './queryBusinessData';
import { queryMoreLogs, buildMoreLogsPrompt } from './queryMoreLogs';
import { getTableSchema, buildTableSchemaPrompt } from './getTableSchema';
import { querySqlLog, buildSqlLogPrompt } from './querySqlLog';
import { ToolResult } from '../types';
import { TOOL_DEFINITIONS } from '../config';

export interface ToolExecutionContext {
  projectId: string;
  apiBaseUrl?: string;
  apiToken?: string;
  apiLogPath?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
  logId?: string;
}

export async function executeTool(
  toolName: string,
  args: any,
  context: ToolExecutionContext
): Promise<ToolResult> {
  console.log(`executeTool: ${toolName}`, JSON.stringify(args, null, 2));

  switch (toolName) {
    case 'query_log':
      return queryLog(args, context.projectId, context.apiBaseUrl, context.apiToken, context.apiLogPath, context.apiTokenPath);

    case 'get_code':
      return getCode(args.serviceName, args.filePath, args.branch, args.tag, context.projectId, args.startLine, args.endLine, args.searchPattern);

    case 'query_business_data':
      return queryBusinessData(args.sql, context.projectId, args.description);

    case 'query_more_logs':
      return queryMoreLogs(
        { ...args, traceId: args.traceId || context.logId },
        context.projectId,
        context.apiBaseUrl,
        context.apiToken,
        context.apiLogPath
      );

    case 'get_table_schema':
      return getTableSchema(args.tableNamePattern);

    case 'query_sql_log':
      return querySqlLog(args, context.projectId, context.apiBaseUrl, context.apiToken, context.apiLogPath);

    default:
      return { success: false, error: `未知工具: ${toolName}` };
  }
}

export function buildToolPrompt(
  toolName: string,
  args: any,
  result: ToolResult
): string {
  if (!result.success) {
    return `工具 ${toolName} 执行失败: ${result.error}`;
  }

  switch (toolName) {
    case 'query_log':
      return buildLogQueryPrompt(args, result.data);

    case 'get_code':
      return buildCodeQueryPrompt(args.serviceName, result.data);

    case 'query_business_data':
      return buildDataQueryPrompt(result.data);

    case 'query_more_logs':
      return buildMoreLogsPrompt(args, result.data);

    case 'get_table_schema':
      return buildTableSchemaPrompt(args, result.data);

    case 'query_sql_log':
      return buildSqlLogPrompt(args, result.data);

    default:
      return `工具 ${toolName} 执行成功，返回数据: ${JSON.stringify(result.data, null, 2)}`;
  }
}

export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}