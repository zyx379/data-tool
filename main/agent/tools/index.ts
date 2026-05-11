import { ToolCall, ToolResult } from '../types';
import { queryLog, buildLogQueryPrompt } from './queryLog';
import { getCode, buildCodeQueryPrompt } from './gitLab';
import { queryBusinessData, buildDataQueryPrompt } from './queryBusinessData';

export interface ToolExecutor {
  (args: Record<string, any>): Promise<ToolResult>;
}

export interface ToolInfo {
  name: string;
  executor: ToolExecutor;
  promptBuilder?: (args: any, result: any) => string;
}

const tools: Map<string, ToolInfo> = new Map();

export function registerTool(tool: ToolInfo) {
  tools.set(tool.name, tool);
}

export function getTool(name: string): ToolInfo | undefined {
  return tools.get(name);
}

export function getAllTools(): ToolInfo[] {
  return Array.from(tools.values());
}

export async function executeTool(
  toolCall: ToolCall,
  dataSourceId: string
): Promise<{ result: ToolResult; prompt: string }> {
  const tool = getTool(toolCall.name);
  
  if (!tool) {
    return {
      result: { success: false, error: `Unknown tool: ${toolCall.name}` },
      prompt: ''
    };
  }

  const args = {
    ...toolCall.arguments,
    dataSourceId,
  };

  const result = await tool.executor(args);
  
  let prompt = '';
  if (result.success && tool.promptBuilder) {
    prompt = tool.promptBuilder(toolCall.arguments, result.data);
  } else if (!result.success) {
    prompt = `工具 ${toolCall.name} 执行失败: ${result.error}`;
  }

  return { result, prompt };
}

export function initializeTools() {
  registerTool({
    name: 'query_log',
    executor: async (args) => {
      return await queryLog(args.logId, args.dataSourceId, args.tableName);
    },
    promptBuilder: (args, result) => {
      return buildLogQueryPrompt(args.logId, result);
    }
  });

  registerTool({
    name: 'get_code',
    executor: async (args) => {
      return await getCode(args.serviceName, args.filePath, args.branch);
    },
    promptBuilder: (args, result) => {
      return buildCodeQueryPrompt(args.serviceName, result);
    }
  });

  registerTool({
    name: 'query_business_data',
    executor: async (args) => {
      return await queryBusinessData(args.sql, args.dataSourceId, args.description);
    },
    promptBuilder: (args, result) => {
      return buildDataQueryPrompt(result);
    }
  });

  console.log(`Initialized ${tools.size} tools`);
}

export function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'query_log',
        description: '根据日志ID查询HIS系统日志表，获取完整的日志内容。',
        parameters: {
          type: 'object',
          properties: {
            logId: {
              type: 'string',
              description: '日志ID，唯一标识一条日志记录'
            },
            tableName: {
              type: 'string',
              description: '日志表名称，默认为 HIS_LOG'
            }
          },
          required: ['logId']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_code',
        description: '根据服务名称从 GitLab 仓库获取微服务代码。',
        parameters: {
          type: 'object',
          properties: {
            serviceName: {
              type: 'string',
              description: '微服务名称'
            },
            filePath: {
              type: 'string',
              description: '文件路径，留空获取项目文件列表'
            }
          },
          required: ['serviceName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'query_business_data',
        description: '执行 SQL 查询从业务数据库获取数据。',
        parameters: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'SQL 查询语句'
            },
            description: {
              type: 'string',
              description: '查询目的说明'
            }
          },
          required: ['sql']
        }
      }
    }
  ];
}
