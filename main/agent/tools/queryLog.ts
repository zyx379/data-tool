import { ApiClient, LogQueryParam } from '../../api-client';
import { getProjectConfig } from '../../database/sqlite';
import { getFirstTokenFromRedis, RedisConfig } from '../../redis';
import { ToolResult } from '../types';

export async function queryLog(
  args: { logId: string; tableName?: string },
  projectId: string,
  apiBaseUrl?: string,
  apiToken?: string,
  apiLogPath?: string,
  apiTokenPath?: string
): Promise<ToolResult> {
  try {
    let configToUse: { baseUrl: string; logPath?: string } | undefined;
    let tokenToUse: string | undefined;

    if (apiBaseUrl && apiLogPath) {
      configToUse = { baseUrl: apiBaseUrl, logPath: apiLogPath };
      tokenToUse = apiToken;
    } else {
      const projectConfig = getProjectConfig(projectId);
      if (projectConfig && projectConfig.apiBaseUrl && projectConfig.apiLogPath) {
        configToUse = {
          baseUrl: projectConfig.apiBaseUrl,
          logPath: projectConfig.apiLogPath,
        };
      }
    }

    if (!tokenToUse) {
      const projectConfig = getProjectConfig(projectId);
      if (projectConfig && projectConfig.redisHost && projectConfig.redisPort) {
        const redisConfig: RedisConfig = {
            host: projectConfig.redisHost!,
            port: projectConfig.redisPort!,
            password: projectConfig.redisPassword || undefined,
            db: projectConfig.redisDb || undefined,
          };
          tokenToUse = await getFirstTokenFromRedis(redisConfig) ?? undefined;
      }
    }

    if (!configToUse) {
      return { success: false, error: '项目未配置 API，无法查询日志' };
    }

    const apiClient = new ApiClient(configToUse);
    if (tokenToUse) {
      apiClient.setToken(tokenToUse);
    }

    const queryParam: LogQueryParam = {
      pageSize: '50',
      pageNum: '1',
      indexvalue: 'log-http*',
      logType: 'http',
      serviceName: '',
      canary: '',
      traceId: args.logId,
      logLevel: [],
      timestamp: { startDate: null, endDate: null },
      filterParam: {
        searchType: '2',
        termChecked: false,
        matchChecked: true,
        wildcardChecked: false,
        operator: '',
        value: '',
        searchValue: args.logId
      }
    };

    console.log('queryLog queryParam:', JSON.stringify(queryParam, null, 2));

    const result = await apiClient.getLogs(queryParam);

    if (result.logs.length === 0) {
      return { success: false, error: '未找到匹配的日志' };
    }

    const allLogs = result.logs;
    const errorLogs = allLogs.filter(l => {
      const level = (l.logLevel || '').toUpperCase();
      return level.includes('ERROR') || level.includes('WARN');
    });

    return {
      success: true,
      data: {
        logId: args.logId,
        totalCount: allLogs.length,
        errorCount: errorLogs.length,
        allLogs: allLogs,
        errorLogs: errorLogs,
        logs: allLogs,
      }
    };
  } catch (error) {
    console.error('queryLog error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildLogQueryPrompt(args: { logId: string }, data: any): string {
  const errorLogs = data.errorLogs || [];
  const allLogs = data.allLogs || [];
  const totalCount = data.totalCount || allLogs.length;
  const errorCount = data.errorCount || errorLogs.length;

  let prompt = `## 日志查询结果\n\n`;
  prompt += `**日志ID**: ${args.logId}\n`;
  prompt += `**总日志数**: ${totalCount}\n`;
  prompt += `**异常日志数 (ERROR/WARN)**: ${errorCount}\n\n`;

  if (errorLogs.length === 0) {
    prompt += `✅ 未发现异常日志，所有日志均为 INFO 或 DEBUG 级别。\n\n`;
    prompt += `### 日志摘要\n`;
    allLogs.slice(0, 5).forEach((log: any, index: number) => {
      prompt += `\n**#${index + 1}** [${log.logLevel}]\n`;
      if (log.serviceName) prompt += `- 服务: ${log.serviceName}\n`;
      if (log.reqUrl) prompt += `- 请求: ${log.reqUrl}\n`;
      if (log.httpStatus) prompt += `- 状态码: ${log.httpStatus}\n`;
    });
    prompt += `\n虽然没有明显的异常日志，但请检查请求参数、状态码和响应时间，排查是否存在业务逻辑问题或性能瓶颈。`;
    return prompt;
  }

  prompt += `### ⚠️ 异常日志详情\n\n`;
  errorLogs.forEach((log: any, index: number) => {
    prompt += `---\n`;
    prompt += `#### 异常 #${index + 1}\n\n`;
    prompt += `| 字段 | 值 |\n`;
    prompt += `|------|----|\n`;
    if (log.logLevel) prompt += `| **日志级别** | ${log.logLevel} |\n`;
    if (log.serviceName) prompt += `| **服务名** | ${log.serviceName} |\n`;
    if (log.reqUrl) prompt += `| **请求URL** | ${log.reqUrl} |\n`;
    if (log.httpStatus) prompt += `| **状态码** | ${log.httpStatus} |\n`;
    if (log.httpMethod) prompt += `| **请求方法** | ${log.httpMethod} |\n`;
    if (log.errorClass) prompt += `| **错误类名** | ${log.errorClass} |\n`;
    if (log.errorMessage) prompt += `| **错误信息** | ${log.errorMessage} |\n`;
    if (log.vueFile) prompt += `| **Vue文件** | ${log.vueFile} |\n`;
    if (log.stackTrace) {
      const stackLines = log.stackTrace.split('\n').slice(0, 5).join('\n');
      prompt += `| **堆栈** | \n\`\`\`\n${stackLines}\n\`\`\` |\n`;
    }
    if (log.requestParams) prompt += `| **请求参数** | \`\`\`json\n${log.requestParams}\n\`\`\` |\n`;
    prompt += `\n`;
  });

  prompt += `\n---\n`;
  prompt += `请重点分析以上异常日志，根据错误类型、堆栈信息和服务名判断问题根因。`;
  return prompt;
}

export function buildSimpleLogDisplay(data: any): string {
  const errorLogs = data.errorLogs || [];
  const totalCount = data.totalCount || 0;
  const errorCount = data.errorCount || errorLogs.length;

  let display = `共找到 ${totalCount} 条日志`;

  if (errorCount === 0) {
    display += `，未发现异常日志（ERROR/WARN）。`;
    return display;
  }

  display += `，其中 ${errorCount} 条异常：\n\n`;

  errorLogs.forEach((log: any, index: number) => {
    const level = log.logLevel || 'UNKNOWN';
    display += `### ${level}: ${log.serviceName || '未知服务'}\n`;
    if (log.reqUrl) display += `- 请求: ${log.reqUrl}\n`;
    if (log.httpStatus) display += `- 状态码: ${log.httpStatus}\n`;
    if (log.errorClass) display += `- 错误类型: ${log.errorClass}\n`;
    if (log.errorMessage) display += `- 错误信息: ${log.errorMessage}\n`;
    if (log.vueFile) display += `- Vue文件: ${log.vueFile}\n`;
    if (index < errorLogs.length - 1) display += `\n`;
  });

  return display;
}