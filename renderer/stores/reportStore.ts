import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChartType, QueryResultData } from '../utils/reportUtils';

export interface ReportMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  queryResult?: QueryResultData;
  chartType?: ChartType;
  title?: string;
  isConfirm?: boolean;
}

export interface ReportRecord {
  id: string;
  projectId: string;
  dataSourceId: string;
  title: string;
  description: string;
  sql: string;
  queryResult: string;
  chartType: string;
  chartConfig: string;
  messages: string;
  createdAt: string;
  updatedAt: string;
}

interface ReportState {
  reportRecords: ReportRecord[];
  currentRecordId: string | null;
  isGenerating: boolean;
  formDescription: string;
  messages: ReportMessage[];
  sessionKey: string;
  currentSql: string | null;
  currentTitle: string;
  currentChartType: ChartType;
  currentQueryResult: QueryResultData | null;
  leftPanelTab: 'history' | 'templates' | 'relationships';
  searchKeyword: string;

  setFormDescription: (v: string) => void;
  setIsGenerating: (v: boolean) => void;
  setMessages: (msgs: ReportMessage[]) => void;
  addMessage: (msg: ReportMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  setCurrentRecordId: (id: string | null) => void;
  setReportRecords: (records: ReportRecord[]) => void;
  setCurrentSql: (sql: string | null) => void;
  setCurrentTitle: (title: string) => void;
  setCurrentChartType: (t: ChartType) => void;
  setCurrentQueryResult: (r: QueryResultData | null) => void;
  setLeftPanelTab: (t: 'history' | 'templates' | 'relationships') => void;
  setSearchKeyword: (k: string) => void;
  newSession: () => void;
  loadFromRecord: (record: ReportRecord) => void;
}

export const useReportStore = create<ReportState>()(
  persist(
    (set, get) => ({
      reportRecords: [],
      currentRecordId: null,
      isGenerating: false,
      formDescription: '',
      messages: [],
      sessionKey: `report_${Date.now()}`,
      currentSql: null,
      currentTitle: '新报表',
      currentChartType: 'table',
      currentQueryResult: null,
      leftPanelTab: 'history',
      searchKeyword: '',

      setFormDescription: (v) => set({ formDescription: v }),
      setIsGenerating: (v) => set({ isGenerating: v }),
      setMessages: (msgs) => set({ messages: msgs }),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastAssistantMessage: (content) =>
        set((s) => {
          const msgs = [...s.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
              msgs[i] = { ...msgs[i], content };
              break;
            }
          }
          return { messages: msgs };
        }),
      setCurrentRecordId: (id) => set({ currentRecordId: id }),
      setReportRecords: (records) => set({ reportRecords: records }),
      setCurrentSql: (sql) => set({ currentSql: sql }),
      setCurrentTitle: (title) => set({ currentTitle: title }),
      setCurrentChartType: (t) => set({ currentChartType: t }),
      setCurrentQueryResult: (r) => set({ currentQueryResult: r }),
      setLeftPanelTab: (t) => set({ leftPanelTab: t }),
      setSearchKeyword: (k) => set({ searchKeyword: k }),
      newSession: () =>
        set({
          sessionKey: `report_${Date.now()}`,
          messages: [],
          currentRecordId: null,
          currentSql: null,
          currentTitle: '新报表',
          currentChartType: 'table',
          currentQueryResult: null,
          formDescription: '',
        }),
      loadFromRecord: (record) => {
        let messages: ReportMessage[] = [];
        let queryResult: QueryResultData | null = null;
        try {
          messages = JSON.parse(record.messages || '[]');
        } catch {
          messages = [];
        }
        try {
          queryResult = JSON.parse(record.queryResult || 'null');
        } catch {
          queryResult = null;
        }
        set({
          currentRecordId: record.id,
          sessionKey: `report_${record.id}`,
          messages,
          currentSql: record.sql || null,
          currentTitle: record.title,
          currentChartType: (record.chartType as ChartType) || 'table',
          currentQueryResult: queryResult,
        });
      },
    }),
    {
      name: 'zoe-devops-report-store',
      partialize: (state) => ({
        reportRecords: state.reportRecords,
        currentRecordId: state.currentRecordId,
        formDescription: state.formDescription,
        leftPanelTab: state.leftPanelTab,
      }),
    }
  )
);
