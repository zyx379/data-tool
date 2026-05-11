import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 分析状态
export type AnalysisStatus = 'analyzing' | 'completed' | 'unconfirmed' | 'resolved' | 'unresolved';

// 对话消息
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: any[];
  toolCallId?: string;
  name?: string;
}

// 分析记录
export interface AnalysisRecord {
  id: string;
  title: string;           // AI 生成的标题
  description: string;     // 用户输入的问题描述
  logId: string;           // 日志 ID
  projectId: string;    // 项目 ID
  projectName: string;  // 项目名称（冗余存储，方便显示）
  aiModel: string;         // 使用的 AI 模型
  status: AnalysisStatus;
  feedback?: string;       // 未解决时的反馈
  conversation: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

// AI 响应接口
export interface AIAnalysisResult {
  success: boolean;
  message: string;
  conversation: ConversationMessage[];
}

// 模块版本（写死示例数据）
export const MODULE_VERSIONS = [
  { name: '收费前端', version: 'v1.58' },
  { name: '收费后端', version: 'v1.58' },
  { name: '门诊前端', version: 'v1.56' },
  { name: '门诊后端', version: 'v1.56' },
  { name: '药房前端', version: 'v1.55' },
  { name: '药房后端', version: 'v1.55' },
  { name: '住院前端', version: 'v1.57' },
  { name: '住院后端', version: 'v1.57' },
  { name: '医保前端', version: 'v1.54' },
  { name: '医保后端', version: 'v1.54' },
];

// AI 模型选项
export const AI_MODELS = [
  { value: 'deepseek-chat', label: 'DeepSeek V3' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5' },
  { value: 'qwen', label: '通义千问' },
  { value: 'wenxin', label: '文心一言' },
];

interface AnalysisStore {
  // 分析记录列表
  records: AnalysisRecord[];
  
  // 当前查看的记录
  currentRecord: AnalysisRecord | null;

  // 流式响应内容（实时更新）
  streamingContent: string;

  // Actions
  createRecord: (params: {
    description: string;
    logId: string;
    projectId: string;
    projectName: string;
    aiModel: string;
  }) => AnalysisRecord;

  updateRecord: (id: string, updates: Partial<AnalysisRecord>) => void;

  deleteRecord: (id: string) => void;

  setCurrentRecord: (record: AnalysisRecord | null) => void;

  // 添加对话消息
  addMessage: (recordId: string, message: Omit<ConversationMessage, 'id' | 'timestamp'>) => void;

  // 更新状态
  updateStatus: (id: string, status: AnalysisStatus, feedback?: string) => void;

  // AI 分析操作
  startAnalysis: (recordId: string) => Promise<void>;
  sendChatMessage: (recordId: string, message: string) => Promise<void>;
  setStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
}

export const useAnalysisStore = create<AnalysisStore>()(
  persist(
    (set, get) => ({
      records: [],
      currentRecord: null,
      streamingContent: '',

      createRecord: (params) => {
        const newRecord: AnalysisRecord = {
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: '分析中...',
          description: params.description,
          logId: params.logId,
          projectId: params.projectId,
          projectName: params.projectName,
          aiModel: params.aiModel,
          status: 'analyzing',
          conversation: [
            {
              id: `msg_${Date.now()}`,
              role: 'user',
              content: `## 问题描述\n\n${params.description}\n\n**日志ID**: ${params.logId}`,
              timestamp: new Date().toLocaleString('zh-CN'),
            },
          ],
          createdAt: new Date().toLocaleString('zh-CN'),
          updatedAt: new Date().toLocaleString('zh-CN'),
        };

        set((state) => ({
          records: [newRecord, ...state.records],
        }));

        return newRecord;
      },

      updateRecord: (id, updates) => {
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, ...updates, updatedAt: new Date().toLocaleString('zh-CN') } : r
          ),
          currentRecord:
            state.currentRecord?.id === id
              ? { ...state.currentRecord, ...updates, updatedAt: new Date().toLocaleString('zh-CN') }
              : state.currentRecord,
        }));
      },

      deleteRecord: (id) => {
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
          currentRecord: state.currentRecord?.id === id ? null : state.currentRecord,
        }));
      },

      setCurrentRecord: (record) => {
        set({ currentRecord: record });
      },

      addMessage: (recordId, message) => {
        const newMessage: ConversationMessage = {
          id: `msg_${Date.now()}`,
          ...message,
          timestamp: new Date().toLocaleString('zh-CN'),
        };

        set((state) => ({
          records: state.records.map((r) =>
            r.id === recordId
              ? {
                  ...r,
                  conversation: [...r.conversation, newMessage],
                  updatedAt: new Date().toLocaleString('zh-CN'),
                }
              : r
          ),
          currentRecord:
            state.currentRecord?.id === recordId
              ? {
                  ...state.currentRecord,
                  conversation: [...state.currentRecord.conversation, newMessage],
                  updatedAt: new Date().toLocaleString('zh-CN'),
                }
              : state.currentRecord,
        }));
      },

      updateStatus: (id, status, feedback) => {
        const updates: Partial<AnalysisRecord> = { status };
        if (feedback !== undefined) {
          updates.feedback = feedback;
        }

        set((state) => ({
          records: state.records.map((r) =>
            r.id === id
              ? { ...r, ...updates, updatedAt: new Date().toLocaleString('zh-CN') }
              : r
          ),
          currentRecord:
            state.currentRecord?.id === id
              ? { ...state.currentRecord, ...updates, updatedAt: new Date().toLocaleString('zh-CN') }
              : state.currentRecord,
        }));
      },

      setStreamingContent: (content) => {
        set({ streamingContent: content });
      },

      clearStreamingContent: () => {
        set({ streamingContent: '' });
      },

      startAnalysis: async (recordId) => {
        const record = get().records.find(r => r.id === recordId);
        if (!record) return;

        set({ streamingContent: '' });
        get().updateStatus(recordId, 'analyzing');

        try {
          const result = await window.electronAPI.startAnalysis({
            description: record.description,
            logId: record.logId,
            projectId: record.projectId,
            aiModel: record.aiModel,
          });

          if (result.success && result.conversation) {
            const assistantMessages = result.conversation.filter(
              (msg) => msg.role === 'assistant' && msg.content
            );

            for (const msg of assistantMessages) {
              get().addMessage(recordId, {
                role: 'assistant',
                content: msg.content,
              });
            }

            const lastMessage = assistantMessages[assistantMessages.length - 1];
            if (lastMessage) {
              let title = '分析完成';
              const content = lastMessage.content;
              
              if (content.includes('原因') || content.includes('分析')) {
                const match = content.match(/[#*]?\s*([^\n#*]+)/);
                if (match) {
                  title = match[1].substring(0, 30);
                }
              }
              
              get().updateRecord(recordId, {
                title: title,
                status: 'completed',
              });
            }
          } else {
            get().addMessage(recordId, {
              role: 'assistant',
              content: result.message || '分析失败，请稍后重试',
            });
            get().updateStatus(recordId, 'unconfirmed');
          }
        } catch (error) {
          console.error('Analysis error:', error);
          get().addMessage(recordId, {
            role: 'assistant',
            content: `分析失败: ${(error as Error).message}`,
          });
          get().updateStatus(recordId, 'unconfirmed');
        }

        set({ streamingContent: '' });
      },

      sendChatMessage: async (recordId, message) => {
        const record = get().records.find(r => r.id === recordId);
        if (!record) return;

        get().addMessage(recordId, {
          role: 'user',
          content: message,
        });

        set({ streamingContent: '' });

        try {
          const result = await window.electronAPI.chatWithAI(message, record.projectId);

          if (result.success && result.conversation) {
            const assistantMessages = result.conversation.filter(
              (msg) => msg.role === 'assistant' && msg.content
            );

            for (const msg of assistantMessages) {
              get().addMessage(recordId, {
                role: 'assistant',
                content: msg.content,
              });
            }
          } else {
            get().addMessage(recordId, {
              role: 'assistant',
              content: result.message || '回复失败，请稍后重试',
            });
          }
        } catch (error) {
          console.error('Chat error:', error);
          get().addMessage(recordId, {
            role: 'assistant',
            content: `回复失败: ${(error as Error).message}`,
          });
        }

        set({ streamingContent: '' });
      },
    }),
    {
      name: 'zoehis-analysis-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
