import { DEEPSEEK_CONFIG } from './config';
import { ConversationMessage, ToolCall } from './types';
import { getToolDefinitions } from './tools';

export interface ChatCompletionRequest {
  messages: ConversationMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      content?: string;
      tool_calls?: any[];
    };
    finish_reason?: string;
  }[];
}

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config?: Partial<typeof DEEPSEEK_CONFIG>) {
    this.apiKey = config?.apiKey || DEEPSEEK_CONFIG.apiKey;
    this.baseUrl = config?.baseUrl || DEEPSEEK_CONFIG.baseUrl;
    this.model = config?.model || DEEPSEEK_CONFIG.model;
  }

  async chat(
    messages: ConversationMessage[],
    options?: {
      temperature?: number;
      max_tokens?: number;
      tools?: boolean;
      stream?: boolean;
      onChunk?: (chunk: StreamChunk) => void;
    }
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    
    const requestBody: any = {
      model: this.model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
      })),
      temperature: options?.temperature ?? DEEPSEEK_CONFIG.temperature,
      max_tokens: options?.max_tokens ?? DEEPSEEK_CONFIG.maxTokens,
    };

    if (options?.tools !== false) {
      requestBody.tools = getToolDefinitions();
      requestBody.tool_choice = 'auto';
    }

    if (options?.stream) {
      requestBody.stream = true;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
    }

    if (options?.stream) {
      return await this.handleStreamResponse(response, options.onChunk);
    }

    return await response.json() as ChatCompletionResponse;
  }

  private async handleStreamResponse(
    response: Response,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatCompletionResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls: any[] = [];
    const readerId = `chatcmpl-${Date.now()}`;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const chunk: StreamChunk = JSON.parse(data);
            
            if (onChunk) {
              onChunk(chunk);
            }

            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
            }
            if (delta?.tool_calls) {
              toolCalls = toolCalls.concat(delta.tool_calls);
            }
          } catch (e) {
            console.warn('Failed to parse stream chunk:', e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: readerId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: fullContent,
          tool_calls: toolCalls.length > 0 ? toolCalls.map((tc, i) => ({
            id: tc.id || `call_${i}`,
            type: 'function',
            function: {
              name: tc.function?.name || '',
              arguments: typeof tc.function?.arguments === 'string' 
                ? tc.function.arguments 
                : JSON.stringify(tc.function?.arguments || {}),
            }
          })) : undefined,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
    };
  }

  async chatSimple(userMessage: string, systemPrompt?: string): Promise<string> {
    const messages: ConversationMessage[] = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: userMessage });

    const response = await this.chat(messages, { tools: false });
    return response.choices[0]?.message?.content || '';
  }
}

export function parseToolCalls(response: ChatCompletionResponse): ToolCall[] {
  const toolCalls = response.choices[0]?.message?.tool_calls || [];
  
  return toolCalls.map((tc, index) => {
    let args: Record<string, any>;
    const argsStr = tc.function?.arguments;
    
    try {
      args = typeof argsStr === 'string' ? JSON.parse(argsStr) : (argsStr || {});
    } catch {
      args = {};
    }

    return {
      name: tc.function?.name || '',
      arguments: args,
    };
  });
}

export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  content: string
): ConversationMessage {
  return {
    role: 'tool',
    content: content,
    toolCallId: toolCallId,
    name: toolName,
  };
}

export function formatMessagesForAPI(
  conversation: ConversationMessage[],
  systemPrompt: string
): ConversationMessage[] {
  const messages: ConversationMessage[] = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of conversation) {
    if (msg.role === 'tool' && msg.toolCallId) {
      messages.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
        name: msg.name,
      });
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content,
        toolCalls: msg.toolCalls,
      });
    } else {
      messages.push(msg);
    }
  }

  return messages;
}
