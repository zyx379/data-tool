export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface LogInfo {
  logId: string;
  content: string;
  serviceName?: string;
  pagePath?: string;
  errorMessage?: string;
  timestamp?: string;
  [key: string]: any;
}

export interface CodeInfo {
  filePath: string;
  content: string;
  serviceName: string;
  branch?: string;
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export interface AnalysisRequest {
  description: string;
  logId: string;
  dataSourceId: string;
  aiModel: string;
}

export interface AnalysisResponse {
  success: boolean;
  message: string;
  conversation: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export type ToolName = 'query_log' | 'get_code' | 'query_business_data';
