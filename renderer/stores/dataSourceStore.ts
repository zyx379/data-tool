import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface DataSource {
  id?: string;
  name: string;
  type: 'oracle' | 'dameng';
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  schema?: string;
  username: string;
  password: string;
  isActive?: number;
  createdAt?: string;
  updatedAt?: string;
  filterRules?: string[];
}

export interface TableColumn {
  columnName: string;
  dataType: string;
  nullable: string;
  dataDefault: string | null;
  comments: string;
  isPrimaryKey: boolean;
  isUsed?: boolean;
  hasData?: boolean;
  dataPercentage?: number;
}

export interface TableIndex {
  indexName: string;
  columnName: string;
  indexType: string;
  uniqueness: string;
}

export interface TableInfo {
  tableName: string;
  comments: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  owner?: string;
}

export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
}

interface SavedQueryConditionTemplate {
  id: string;
  name: string;
  tableName: string;
  columns: string[];
  operators: string[];
  createdAt: string;
}

interface CachedSchema {
  [dataSourceId: string]: {
    tables: TableInfo[];
    updatedAt: string;
  };
}

interface DataSourceStore {
  dataSources: DataSource[];
  activeDataSource: DataSource | null;
  schema: TableInfo[];
  schemaLoading: boolean;
  schemaError: string | null;
  lastSchemaUpdate: Date | null;
  filterRules: string[];
  cachedSchema: CachedSchema;
  usedFields: Record<string, Record<string, boolean>>;
  showOnlyUsedFieldsByTable: Record<string, boolean>;
  columnSearchTerm: string;
  sidebarCollapsed: boolean;
  tableListCollapsed: boolean;
  schemaFilterPattern: string;
  schemaFilterHistory: string[];
  abortController: AbortController | null;
  schemaProgress: SchemaProgress | null;
  filterEmptyTables: boolean;
  savedQueryConditionTemplates: SavedQueryConditionTemplate[];
  loadDataSources: () => Promise<void>;
  createDataSource: (ds: Omit<DataSource, 'id'>) => Promise<DataSource>;
  updateDataSource: (id: string, ds: Partial<DataSource>) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  testConnection: (ds: DataSource) => Promise<{ success: boolean; message: string }>;
  loadSchema: (dataSourceId: string, useCache?: boolean, mergeWithExisting?: boolean, filterEmptyTables?: boolean) => Promise<void>;
  loadSchemaFromCache: (dataSourceId: string) => Promise<boolean>;
  refreshSchema: () => Promise<void>;
  refreshSchemaWithMerge: () => Promise<void>;
  cancelSchemaLoad: () => void;
  removeTable: (tableName: string) => Promise<void>;
  removeTables: (tableNames: string[]) => Promise<void>;
  setSchemaFilterPattern: (pattern: string) => void;
  addSchemaFilterHistory: (pattern: string) => void;
  setSchemaProgress: (progress: SchemaProgress | null) => void;
  setFilterEmptyTables: (value: boolean) => void;
  setFilterRules: (rules: string[]) => void;
  toggleFieldUsed: (dataSourceId: string, tableName: string, columnName: string, used: boolean) => void;
  getUsedFields: (dataSourceId: string, tableName: string) => Set<string>;
  setShowOnlyUsedFieldsByTable: (tableKey: string, value: boolean) => void;
  getShowOnlyUsedFieldsByTable: (tableKey: string) => boolean;
  setColumnSearchTerm: (value: string) => void;
  toggleSidebar: () => void;
  toggleTableList: () => void;
  saveQueryConditionTemplate: (name: string, tableName: string, columns: string[], operators: string[]) => void;
  deleteQueryConditionTemplate: (id: string) => void;
  getQueryConditionTemplatesForTable: (tableName: string) => SavedQueryConditionTemplate[];
}

declare global {
  interface Window {
    electronAPI: {
      getDataSources: () => Promise<any[]>;
      createDataSource: (ds: any) => Promise<any>;
      updateDataSource: (id: string, ds: any) => Promise<any>;
      deleteDataSource: (id: string) => Promise<void>;
      setActiveDataSource: (id: string) => Promise<void>;
      getActiveDataSource: () => Promise<any>;
      testConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
      getQueryHistory: () => Promise<any[]>;
      clearQueryHistory: () => Promise<void>;
      getSchema: (dataSourceId: string, ownerFilter?: string, tableNamePattern?: string, useCache?: boolean, filterEmptyTables?: boolean) => Promise<TableInfo[]>;
      getSchemaFromCache: (dataSourceId: string) => Promise<TableInfo[]>;
      executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
      onSchemaProgress: (callback: (progress: SchemaProgress) => void) => () => void;
      cancelSchemaLoad: () => Promise<void>;
      removeTableFromCache: (dataSourceId: string, tableName: string) => Promise<void>;
      removeTablesFromCache: (dataSourceId: string, tableNames: string[]) => Promise<void>;
      startAnalysis: (request: {
        description: string;
        logId: string;
        projectId: string;
        aiModel: string;
      }) => Promise<{
        success: boolean;
        message: string;
        conversation: Array<{
          role: string;
          content: string;
          toolCalls?: any[];
          toolCallId?: string;
          name?: string;
        }>;
      }>;
      chatWithAI: (message: string, projectId: string) => Promise<{
        success: boolean;
        message: string;
        conversation: Array<{
          role: string;
          content: string;
          toolCalls?: any[];
          toolCallId?: string;
          name?: string;
        }>;
      }>;
      setGitLabConfig: (config: { baseUrl: string; token: string; defaultBranch?: string }) => Promise<{ success: boolean; message: string }>;
      onAIStream: (callback: (content: string) => void) => () => void;
      project: {
        getAll: () => Promise<any[]>;
        getById: (id: string) => Promise<any>;
        create: (project: { name: string; description?: string; isActive?: number }) => Promise<any>;
        update: (id: string, project: any) => Promise<any>;
        delete: (id: string) => Promise<void>;
        setActive: (id: string) => Promise<void>;
        getActive: () => Promise<any>;
        getActiveWithDetails: () => Promise<any>;
        getDataSources: (projectId: string) => Promise<any[]>;
        getDataSourceById: (id: string) => Promise<any>;
        createDataSource: (ds: any) => Promise<any>;
        updateDataSource: (id: string, ds: any) => Promise<any>;
        deleteDataSource: (id: string) => Promise<void>;
        getConfig: (projectId: string) => Promise<any>;
        saveConfig: (config: any) => Promise<any>;
        deleteConfig: (projectId: string) => Promise<void>;
        testDataSourceConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
        executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
      };
    };
  }
}

export const useDataSourceStore = create<DataSourceStore>()(
  persist(
    (set, get) => ({
      dataSources: [],
      activeDataSource: null,
      schema: [],
      schemaLoading: false,
      schemaError: null,
      lastSchemaUpdate: null,
      filterRules: ['^'],
      cachedSchema: {},
      usedFields: {},
      showOnlyUsedFieldsByTable: {},
      columnSearchTerm: '',
      sidebarCollapsed: false,
      tableListCollapsed: false,
      schemaFilterPattern: '',
      schemaFilterHistory: [],
      abortController: null,
      schemaProgress: null,
      filterEmptyTables: false,
      savedQueryConditionTemplates: [],

      loadDataSources: async () => {
        try {
          const dataSources = await window.electronAPI.getDataSources();
          const activeDataSource = await window.electronAPI.getActiveDataSource();
          set({ dataSources, activeDataSource });
        } catch (error) {
          console.error('Failed to load data sources:', error);
        }
      },

      createDataSource: async (ds) => {
        const result = await window.electronAPI.createDataSource(ds);
        await get().loadDataSources();
        return result;
      },

      updateDataSource: async (id, ds) => {
        const result = await window.electronAPI.updateDataSource(id, ds);
        await get().loadDataSources();
        return result;
      },

      deleteDataSource: async (id) => {
        await window.electronAPI.deleteDataSource(id);
        await get().loadDataSources();
      },

      setActiveDataSource: async (id) => {
        await window.electronAPI.setActiveDataSource(id);
        await get().loadDataSources();
      },

      testConnection: async (ds) => {
        return await window.electronAPI.testConnection(ds);
      },

      loadSchema: async (dataSourceId, useCache = true, mergeWithExisting = false, filterEmptyTables = false) => {
      const controller = new AbortController();
      const currentSchema = [...get().schema];
      set({ schemaLoading: true, schemaError: null, abortController: controller });

      try {
        const { schemaFilterPattern } = get();

        let ownerFilter: string | undefined;
        let tableNamePattern: string | undefined;

        if (schemaFilterPattern) {
          const ownerMatch = schemaFilterPattern.match(/^([A-Za-z0-9_]+)\.(.+)$/);
          if (ownerMatch) {
            ownerFilter = ownerMatch[1].toUpperCase();
            tableNamePattern = ownerMatch[2];
          } else {
            tableNamePattern = schemaFilterPattern;
          }
        }

        const schema = await window.electronAPI.getSchema(dataSourceId, ownerFilter, tableNamePattern, useCache, filterEmptyTables);

        if (controller.signal.aborted) {
          set({ schema: currentSchema, schemaLoading: false, abortController: null });
          return;
        }

        let filteredSchema = schema;
        if (schemaFilterPattern) {
          try {
            const regex = new RegExp(schemaFilterPattern);
            filteredSchema = schema.filter(t => {
              if (regex.test(t.tableName)) {
                return true;
              }
              const tableNameOnly = t.tableName.split('.').pop() || t.tableName;
              return regex.test(tableNameOnly);
            });
          } catch (e) {
          }
        }

        const processedSchema: TableInfo[] = filteredSchema.map(table => ({
          ...table,
          columns: table.columns.map(col => ({
            ...col,
            isUsed: col.isUsed ?? (col.hasData && !col.isPrimaryKey),
          })),
        }));

        set((state) => {
          let mergedTables: TableInfo[] = processedSchema;

          if (mergeWithExisting && state.schema.length > 0) {
            const existingTableNames = new Set(state.schema.map(t => t.tableName));
            const newTables = processedSchema.filter(t => !existingTableNames.has(t.tableName));
            mergedTables = [...state.schema, ...newTables];
          }

          return {
            schema: mergedTables,
            schemaLoading: false,
            abortController: null,
            lastSchemaUpdate: new Date(),
          };
        });
      } catch (error) {
        if ((error as Error).message === 'Operation cancelled' || controller.signal.aborted) {
          set({ schema: currentSchema, schemaLoading: false, abortController: null });
          return;
        }
        console.error('Failed to load schema:', error);
        set({ schema: currentSchema, schemaLoading: false, schemaError: (error as Error).message, abortController: null });
      }
    },

    loadSchemaFromCache: async (dataSourceId: string) => {
      try {
        console.log('[DEBUG] loadSchemaFromCache called with dataSourceId:', dataSourceId);
        const schema = await window.electronAPI.getSchemaFromCache(dataSourceId);
        console.log('[DEBUG] getSchemaFromCache returned schema with length:', schema.length);
        if (schema.length > 0) {
          const processedSchema: TableInfo[] = schema.map(table => ({
            ...table,
            columns: table.columns.map(col => ({
              ...col,
              isUsed: col.isUsed ?? (col.hasData && !col.isPrimaryKey),
            })),
          }));
          console.log('[DEBUG] Setting schema with', processedSchema.length, 'tables');
          set({
            schema: processedSchema,
            schemaLoading: false,
            schemaError: null,
            lastSchemaUpdate: new Date(),
            schemaFilterPattern: '',
          });
          return true;
        } else {
          console.log('[DEBUG] Schema from cache is empty, returning false');
        }
        return false;
      } catch (error) {
        console.error('[DEBUG] Error loading schema from cache:', error);
        return false;
      }
    },

      removeTable: async (tableName: string) => {
        const { activeDataSource } = get();
        set((state) => ({
          schema: state.schema.filter(t => t.tableName !== tableName),
        }));
        if (activeDataSource?.id) {
          await window.electronAPI.removeTableFromCache(activeDataSource.id, tableName);
        }
      },

      removeTables: async (tableNames: string[]) => {
        const { activeDataSource } = get();
        const tableNameSet = new Set(tableNames);
        set((state) => ({
          schema: state.schema.filter(t => !tableNameSet.has(t.tableName)),
        }));
        if (activeDataSource?.id) {
          await window.electronAPI.removeTablesFromCache(activeDataSource.id, tableNames);
        }
      },

      refreshSchema: async (dataSourceId?: string) => {
        const { activeDataSource, filterEmptyTables } = get();
        const id = dataSourceId || activeDataSource?.id;
        if (id) {
          await get().loadSchema(id, false, false, filterEmptyTables);
        }
      },

      refreshSchemaWithMerge: async (dataSourceId?: string) => {
        const { activeDataSource, filterEmptyTables } = get();
        const id = dataSourceId || activeDataSource?.id;
        if (id) {
          await get().loadSchema(id, false, true, filterEmptyTables);
        }
      },

      cancelSchemaLoad: async () => {
      const { abortController } = get();
      if (abortController) {
        abortController.abort();
      }
      try {
        await window.electronAPI.cancelSchemaLoad();
      } catch (error) {
        console.error('Error cancelling schema load:', error);
      }
      set({ schemaLoading: false, abortController: null });
    },

      setSchemaFilterPattern: (pattern) => {
        set({ schemaFilterPattern: pattern });
      },

      addSchemaFilterHistory: (pattern) => {
        if (!pattern) return;
        set((state) => {
          const history = state.schemaFilterHistory.filter(p => p !== pattern);
          return { schemaFilterHistory: [pattern, ...history].slice(0, 10) };
        });
      },

      setSchemaProgress: (progress) => {
      set({ schemaProgress: progress });
    },

    setFilterEmptyTables: (value) => {
      set({ filterEmptyTables: value });
    },

      setFilterRules: (rules) => {
        set({ filterRules: rules });
      },

      toggleFieldUsed: (dataSourceId, tableName, columnName, used) => {
        set((state) => {
          const key = `${dataSourceId}_${tableName}`;
          const tableFields = state.usedFields[key] || {};
          tableFields[columnName] = used;
          return {
            usedFields: {
              ...state.usedFields,
              [key]: tableFields,
            },
          };
        });
      },

      getUsedFields: (dataSourceId, tableName) => {
        const key = `${dataSourceId}_${tableName}`;
        const tableFields = get().usedFields[key] || {};
        return new Set(Object.keys(tableFields).filter((f) => tableFields[f]));
      },

      setShowOnlyUsedFieldsByTable: (tableKey, value) => {
        set((state) => ({
          showOnlyUsedFieldsByTable: {
            ...state.showOnlyUsedFieldsByTable,
            [tableKey]: value,
          },
        }));
      },

      getShowOnlyUsedFieldsByTable: (tableKey) => {
        return get().showOnlyUsedFieldsByTable[tableKey] || false;
      },

      setColumnSearchTerm: (value) => {
        set({ columnSearchTerm: value });
      },

      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },

      toggleTableList: () => {
        set((state) => ({ tableListCollapsed: !state.tableListCollapsed }));
      },

      saveQueryConditionTemplate: (name, tableName, columns, operators) => {
        const template: SavedQueryConditionTemplate = {
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name,
          tableName,
          columns,
          operators,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          savedQueryConditionTemplates: [...state.savedQueryConditionTemplates, template],
        }));
      },

      deleteQueryConditionTemplate: (id) => {
        set((state) => ({
          savedQueryConditionTemplates: state.savedQueryConditionTemplates.filter(t => t.id !== id),
        }));
      },

      getQueryConditionTemplatesForTable: (tableName) => {
        return get().savedQueryConditionTemplates.filter(t => t.tableName === tableName);
      },
    }),
    {
      name: 'zoehis-helper-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        filterRules: state.filterRules,
        usedFields: state.usedFields,
        showOnlyUsedFieldsByTable: state.showOnlyUsedFieldsByTable,
        columnSearchTerm: state.columnSearchTerm,
        sidebarCollapsed: state.sidebarCollapsed,
        tableListCollapsed: state.tableListCollapsed,
        schemaFilterPattern: state.schemaFilterPattern,
        schemaFilterHistory: state.schemaFilterHistory,
        savedQueryConditionTemplates: state.savedQueryConditionTemplates,
      }),
    }
  )
);
