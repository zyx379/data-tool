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
  id?: string;
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
  logs?: any[];
  errorLogs?: any[];
  totalCount?: number;
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
  projectId: string;
  moduleVersions?: Array<{ name: string; version: string; updateTime?: string }>;
  apiBaseUrl?: string;
  apiToken?: string;
  apiLogPath?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
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

export type ToolName = 'query_log' | 'get_code' | 'query_business_data' | 'query_more_logs' | 'get_table_schema';

export type AnalysisStepId =
  | 'query_log'
  | 'identify_service'
  | 'match_repository'
  | 'fetch_version_and_code'
  | 'deep_analysis'
  | 'conclusion';

export type StepStatus = 'pending' | 'loading' | 'completed' | 'error';

export interface AnalysisStepData {
  id: AnalysisStepId;
  status: StepStatus;
  title: string;
  content: string;
  data?: any;
  error?: string;
  timestamp: string;
}

export interface StepCallback {
  onStepStart: (stepId: AnalysisStepId) => void;
  onStepUpdate: (stepData: AnalysisStepData) => void;
  onStepComplete: (stepData: AnalysisStepData) => void;
  onStepError: (stepId: AnalysisStepId, error: string) => void;
  onStreamChunk: (content: string) => void;
}

export interface ServiceIdentification {
  serviceName: string;
  isFrontend: boolean;
  reasoning: string;
  suggestedDirection: 'frontend' | 'backend';
}

export interface RepositoryMatchResult {
  matched: boolean;
  repository?: {
    id: string;
    name: string;
    repositoryUrl: string;
    servicePatterns: string;
    defaultBranch: string;
  };
  availableRepositories: Array<{ name: string }>;
}

export interface VersionAndCodeResult {
  versionTag: string;
  moduleName: string;
  branch: string;
  files: string[];
  totalFiles: number;
  repositoryName: string;
}