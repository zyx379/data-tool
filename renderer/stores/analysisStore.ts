import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ModuleVersion {
  name: string;
  version: string;
  updateTime?: string;
}

export interface AnalysisStepData {
  id: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
  title: string;
  content: string;
  data?: any;
  error?: string;
  timestamp: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: any[];
  toolCallId?: string;
  name?: string;
}

export interface AnalysisRecord {
  id: string;
  description: string;
  logId: string;
  projectId: string;
  projectName: string;
  timestamp: string;
  steps: AnalysisStepData[];
  status: 'analyzing' | 'completed' | 'error';
  error?: string;
}

interface AnalysisState {
  analysisRecords: AnalysisRecord[];
  currentRecordId: string | null;
  isAnalyzing: boolean;

  formDescription: string;
  formLogId: string;

  deepAnalysisStreamContent: string;

  setFormDescription: (desc: string) => void;
  setFormLogId: (logId: string) => void;
  clearForm: () => void;

  startAnalysis: (id: string, description: string, logId: string, projectId: string, projectName: string) => void;
  updateStep: (stepData: AnalysisStepData) => void;
  completeStep: (stepData: AnalysisStepData) => void;
  errorStep: (stepData: AnalysisStepData) => void;
  appendStreamChunk: (content: string) => void;
  clearStreamContent: () => void;
  finishAnalysis: (error?: string) => void;

  setCurrentRecordId: (id: string | null) => void;
  deleteRecord: (id: string) => void;
  clearAllRecords: () => void;
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set, get) => ({
      analysisRecords: [],
      currentRecordId: null,
      isAnalyzing: false,

      formDescription: '',
      formLogId: '',

      deepAnalysisStreamContent: '',

      setFormDescription: (desc) => set({ formDescription: desc }),
      setFormLogId: (logId) => set({ formLogId: logId }),
      clearForm: () => set({ formDescription: '', formLogId: '' }),

      startAnalysis: (id, description, logId, projectId, projectName) => {
        const record: AnalysisRecord = {
          id,
          description,
          logId,
          projectId,
          projectName,
          timestamp: new Date().toISOString(),
          steps: [],
          status: 'analyzing',
        };

        set((state) => ({
          analysisRecords: [record, ...state.analysisRecords],
          currentRecordId: id,
          isAnalyzing: true,
          deepAnalysisStreamContent: '',
        }));
      },

      updateStep: (stepData) => {
        set((state) => {
          const records = state.analysisRecords.map((r) => {
            if (r.id !== state.currentRecordId) return r;
            const existingIndex = r.steps.findIndex((s) => s.id === stepData.id);
            const steps = [...r.steps];
            if (existingIndex >= 0) {
              steps[existingIndex] = { ...steps[existingIndex], ...stepData };
            } else {
              steps.push(stepData);
            }
            return { ...r, steps };
          });
          return { analysisRecords: records };
        });
      },

      completeStep: (stepData) => {
        set((state) => {
          const records = state.analysisRecords.map((r) => {
            if (r.id !== state.currentRecordId) return r;
            const existingIndex = r.steps.findIndex((s) => s.id === stepData.id);
            const steps = [...r.steps];
            const completedStep = { ...stepData, status: 'completed' as const };
            if (existingIndex >= 0) {
              steps[existingIndex] = completedStep;
            } else {
              steps.push(completedStep);
            }
            return { ...r, steps };
          });
          return { analysisRecords: records };
        });
      },

      errorStep: (stepData) => {
        set((state) => {
          const records = state.analysisRecords.map((r) => {
            if (r.id !== state.currentRecordId) return r;
            const existingIndex = r.steps.findIndex((s) => s.id === stepData.id);
            const steps = [...r.steps];
            const errorStep = { ...stepData, status: 'error' as const };
            if (existingIndex >= 0) {
              steps[existingIndex] = errorStep;
            } else {
              steps.push(errorStep);
            }
            return { ...r, steps };
          });
          return { analysisRecords: records };
        });
      },

      appendStreamChunk: (content) => {
        set((state) => ({
          deepAnalysisStreamContent: state.deepAnalysisStreamContent + content,
        }));
      },

      clearStreamContent: () => set({ deepAnalysisStreamContent: '' }),

      finishAnalysis: (error) => {
        set((state) => {
          const records = state.analysisRecords.map((r) => {
            if (r.id !== state.currentRecordId) return r;
            return {
              ...r,
              status: error ? 'error' as const : 'completed' as const,
              error: error || undefined,
            };
          });
          return {
            analysisRecords: records,
            isAnalyzing: false,
          };
        });
      },

      setCurrentRecordId: (id) => set({ currentRecordId: id }),

      deleteRecord: (id) => {
        set((state) => ({
          analysisRecords: state.analysisRecords.filter((r) => r.id !== id),
          currentRecordId: state.currentRecordId === id ? null : state.currentRecordId,
        }));
      },

      clearAllRecords: () => {
        set({
          analysisRecords: [],
          currentRecordId: null,
          isAnalyzing: false,
          deepAnalysisStreamContent: '',
        });
      },
    }),
    {
      name: 'zoe-devops-analysis-store',
      partialize: (state) => ({
        analysisRecords: state.analysisRecords.filter((r) => r.status !== 'analyzing'),
        formDescription: state.formDescription,
        formLogId: state.formLogId,
      }),
    }
  )
);