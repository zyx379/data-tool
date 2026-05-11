import { DeepSeekClient, parseToolCalls, createToolResultMessage, formatMessagesForAPI } from './deepseek';
import { SYSTEM_PROMPT } from './config';
import { initializeTools, executeTool, getTool } from './tools';
import { 
  ConversationMessage, 
  ToolCall, 
  ToolResult,
  AnalysisRequest,
  AnalysisResponse 
} from './types';

export interface AgentConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxIterations?: number;
  streamCallback?: (content: string) => void;
}

export class HISAnalysisAgent {
  private client: DeepSeekClient;
  private conversation: ConversationMessage[] = [];
  private maxIterations: number;
  private streamCallback?: (content: string) => void;

  constructor(config?: AgentConfig) {
    this.client = new DeepSeekClient({
      apiKey: config?.apiKey,
      baseUrl: config?.baseUrl,
      model: config?.model,
    });
    this.maxIterations = config?.maxIterations || 5;
    this.streamCallback = config?.streamCallback;
    
    initializeTools();
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    try {
      this.conversation = [];

      this.conversation.push({
        role: 'user',
        content: `## 新建分析任务\n\n**问题描述**: ${request.description}\n\n**日志ID**: ${request.logId}\n\n**数据源**: ${request.dataSourceId}\n\n请按以下步骤进行分析：\n1. 首先调用 query_log 工具查询日志详情\n2. 分析日志内容\n3. 根据需要调用其他工具\n4. 最后给出分析结论`
      });

      const result = await this.runAgentLoop(request.dataSourceId);

      return result;
    } catch (error) {
      console.error('Analysis error:', error);
      return {
        success: false,
        message: `分析失败: ${(error as Error).message}`,
        conversation: this.conversation,
      };
    }
  }

  private async runAgentLoop(dataSourceId: string): Promise<AnalysisResponse> {
    let iteration = 0;
    let finalContent = '';

    while (iteration < this.maxIterations) {
      iteration++;

      const formattedMessages = formatMessagesForAPI(this.conversation, SYSTEM_PROMPT);

      const response = await this.client.chat(formattedMessages, {
        stream: !!this.streamCallback,
        onChunk: this.streamCallback ? (chunk) => {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            this.streamCallback!(content);
          }
        } : undefined,
      });

      const assistantMessage = response.choices[0]?.message;
      
      if (!assistantMessage) {
        return {
          success: false,
          message: 'AI 响应格式错误',
          conversation: this.conversation,
        };
      }

      this.conversation.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        toolCalls: assistantMessage.tool_calls ? parseToolCalls(response) : undefined,
      });

      const toolCalls = parseToolCalls(response);

      if (toolCalls.length === 0) {
        finalContent = assistantMessage.content || '';
        break;
      }

      for (const toolCall of toolCalls) {
        const toolResult = await executeTool(toolCall, dataSourceId);
        
        this.conversation.push(createToolResultMessage(
          `call_${iteration}_${toolCall.name}`,
          toolCall.name,
          toolResult.result.success 
            ? (toolResult.prompt || JSON.stringify(toolResult.result.data, null, 2))
            : `错误: ${toolResult.result.error}`
        ));
      }

      finalContent += assistantMessage.content || '';
    }

    if (iteration >= this.maxIterations) {
      finalContent += '\n\n[注意: 分析已达到最大迭代次数，建议手动检查]';
    }

    return {
      success: true,
      message: '分析完成',
      conversation: this.conversation,
    };
  }

  async chat(userMessage: string, dataSourceId: string): Promise<AnalysisResponse> {
    try {
      this.conversation.push({
        role: 'user',
        content: userMessage,
      });

      let iteration = 0;
      let finalContent = '';

      while (iteration < this.maxIterations) {
        iteration++;

        const formattedMessages = formatMessagesForAPI(this.conversation, SYSTEM_PROMPT);

        const response = await this.client.chat(formattedMessages, {
          stream: !!this.streamCallback,
          onChunk: this.streamCallback ? (chunk) => {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              this.streamCallback!(content);
            }
          } : undefined,
        });

        const assistantMessage = response.choices[0]?.message;
        
        if (!assistantMessage) {
          return {
            success: false,
            message: 'AI 响应格式错误',
            conversation: this.conversation,
          };
        }

        const toolCalls = parseToolCalls(response);

        this.conversation.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });

        if (toolCalls.length === 0) {
          finalContent = assistantMessage.content || '';
          break;
        }

        for (const toolCall of toolCalls) {
          const toolResult = await executeTool(toolCall, dataSourceId);
          
          this.conversation.push(createToolResultMessage(
            `call_${iteration}_${toolCall.name}`,
            toolCall.name,
            toolResult.result.success 
              ? (toolResult.prompt || JSON.stringify(toolResult.result.data, null, 2))
              : `错误: ${toolResult.result.error}`
          ));
        }

        finalContent += assistantMessage.content || '';
      }

      return {
        success: true,
        message: finalContent || '分析完成',
        conversation: this.conversation,
      };
    } catch (error) {
      console.error('Chat error:', error);
      return {
        success: false,
        message: `对话失败: ${(error as Error).message}`,
        conversation: this.conversation,
      };
    }
  }

  reset() {
    this.conversation = [];
  }

  getConversation(): ConversationMessage[] {
    return this.conversation;
  }
}

let agentInstance: HISAnalysisAgent | null = null;

export function getAgentInstance(config?: AgentConfig): HISAnalysisAgent {
  if (!agentInstance) {
    agentInstance = new HISAnalysisAgent(config);
  }
  return agentInstance;
}

export function resetAgent() {
  agentInstance = null;
}
