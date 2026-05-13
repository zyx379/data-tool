import { ApiClient, LogQueryParam } from '../../api-client';
import { getProjectConfig } from '../../database/sqlite';
import { ToolResult } from '../types';

export async function queryMoreLogs(
  args: {
    serviceName?: string;
    logLevel?: string[];
    timeRange?: { startDate: string; endDate: string };
    traceId?: string;
  },
  projectId: string,
  apiBaseUrl?: string,
  apiToken?: string,
  apiLogPath?: string
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

    if (!configToUse) {
      return { success: false, error: '项目未配置 API，无法查询日志' };
    }

    const apiClient = new ApiClient(configToUse);
    if (tokenToUse) {
      apiClient.setToken(tokenToUse);
    }

    const queryParam: LogQueryParam = {
      pageSize: '20',
      pageNum: '1',
      indexvalue: 'log-http*',
      logType: 'http',
      serviceName: args.serviceName || '',
      canary: '',
      traceId: args.traceId || '',
      logLevel: args.logLevel || [],
      timestamp: {
        startDate: args.timeRange?.startDate || null,
        endDate: args.timeRange?.endDate || null
      },
      filterParam: {
        searchType: '2',
        termChecked: false,
        matchChecked: true,
        wildcardChecked: false,
        operator: '',
        value: '',
        searchValue: args.traceId || ''
      }
    };

    console.log('queryMoreLogs queryParam:', JSON.stringify(queryParam, null, 2));

    const result = await apiClient.getLogs(queryParam);

    if (result.logs.length === 0) {
      return { success: false, error: '未找到匹配的日志' };
    }

    const sortedLogs = [...result.logs].sort((a, b) => {
      const priority = (logLevel: string) => {
        const level = (logLevel || '').toUpperCase();
        if (level.includes('ERROR')) return 0;
        if (level.includes('WARN')) return 1;
        if (level.includes('INFO')) return 2;
        return 3;
      };
      return priority(a.logLevel) - priority(b.logLevel);
    });

    const errorLogs = sortedLogs.filter(l => {
      const level = (l.logLevel || '').toUpperCase();
      return level.includes('ERROR') || level.includes('WARN');
    });

    return {
      success: true,
      data: {
        total: result.total,
        logs: sortedLogs,
        errorCount: errorLogs.length,
        totalCount: sortedLogs.length,
        summary: sortedLogs.slice(0, 5).map(l => ({
          logLevel: l.logLevel,
          serviceName: l.serviceName,
          reqUrl: l.reqUrl,
          errorMessage: l.errorMessage,
          httpStatus: l.httpStatus,
        })),
      }
    };
  } catch (error) {
    console.error('queryMoreLogs error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildMoreLogsPrompt(args: any, result: any): string {
  let prompt = `## 扩展日志查询结果\n\n`;
  prompt += `**查询条件**: 服务名=${args.serviceName || '不限'}, 日志级别=${args.logLevel?.join(',') || '不限'}\n`;
  prompt += `**总日志数**: ${result.totalCount || 0}\n`;
  prompt += `**异常日志数**: ${result.errorCount || 0}\n\n`;

  if (result.summary && result.summary.length > 0) {
    prompt += `### 日志摘要（前5条）:\n`;
    result.summary.forEach((log: any, index: number) => {
      prompt += `\n**#${index + 1}** [${log.logLevel}]\n`;
      if (log.serviceName) prompt += `- 服务: ${log.serviceName}\n`;
      if (log.reqUrl) prompt += `- 请求: ${log.reqUrl}\n`;
      if (log.httpStatus) prompt += `- 状态码: ${log.httpStatus}\n`;
      if (log.errorMessage) prompt += `- 错误: ${log.errorMessage}\n`;
    });
  }

  prompt += `\n请根据以上扩展日志信息，结合之前的分析，继续深入排查。`;
  return prompt;
}