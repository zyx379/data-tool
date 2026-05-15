import { DeepSeekClient, parseToolCalls, createToolResultMessage } from './deepseek';
import { executeTool, buildToolPrompt, ToolExecutionContext } from './tools';
import { ConversationMessage, ToolCall } from './types';
import { CHAT_SYSTEM_PROMPT } from './config';
import { getGlobalConfig } from '../database/sqlite';

export class ChatSession {
  private deepseekClient: DeepSeekClient;
  private conversation: ConversationMessage[];
  private context: ToolExecutionContext;
  private maxIterations = 5;

  constructor(
    analysisConversation: ConversationMessage[],
    context: ToolExecutionContext
  ) {
    const globalConfig = getGlobalConfig();
    this.deepseekClient = new DeepSeekClient({
      apiKey: globalConfig?.deepseekApiKey || '',
      baseUrl: globalConfig?.deepseekBaseUrl || undefined,
      model: globalConfig?.deepseekModel || 'deepseek-chat',
    });

    this.conversation = [...analysisConversation];
    this.context = context;
  }

  async sendMessage(
    userMessage: string,
    onChunk: (content: string) => void
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    this.conversation.push({
      role: 'user',
      content: userMessage,
    });

    let iterations = 0;
    let fullContent = '';
    const allToolCalls: ToolCall[] = [];

    while (iterations < this.maxIterations) {
      iterations++;

      const messages: ConversationMessage[] = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...this.conversation,
      ];

      let streamContent = '';
      const response = await this.deepseekClient.chat(messages, {
        tools: true,
        stream: true,
        onChunk: (chunk) => {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            streamContent += delta.content;
            onChunk(delta.content);
          }
        },
      });

      const assistantContent = response.choices[0]?.message?.content || streamContent;
      const toolCalls = parseToolCalls(response);

      if (assistantContent) {
        fullContent += assistantContent;
        this.conversation.push({
          role: 'assistant',
          content: assistantContent,
        });
      }

      const validToolCalls = toolCalls.filter(tc => tc.name && tc.name.trim());
      if (validToolCalls.length === 0) break;

      for (const tc of validToolCalls) {
        allToolCalls.push(tc);

        this.conversation.push({
          role: 'assistant',
          content: `调用工具: ${tc.name}`,
          toolCalls: [tc],
        });

        const result = await executeTool(tc.name, tc.arguments, this.context);
        const toolPrompt = buildToolPrompt(tc.name, tc.arguments, result);

        this.conversation.push(
          createToolResultMessage(
            tc.id || `call_${iterations}`,
            tc.name,
            toolPrompt
          )
        );
      }
    }

    return { content: fullContent, toolCalls: allToolCalls };
  }
}