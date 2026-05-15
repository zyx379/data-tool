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
  detail?: string;
}

export type SavedConditionJoin = 'AND' | 'OR';

export interface SavedQueryConditionTemplate {
  id: string;
  name: string;
  tableName: string;
  columns: string[];
  operators: string[];
  /** 与上一行的连接，长度应为 columns.length - 1；缺省表示全部为 AND */
  joins?: SavedConditionJoin[];
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
  filterNoCommentTables: boolean;
  savedQueryConditionTemplates: SavedQueryConditionTemplate[];
  loadDataSources: () => Promise<void>;
  createDataSource: (ds: Omit<DataSource, 'id'>) => Promise<DataSource>;
  updateDataSource: (id: string, ds: Partial<DataSource>) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  testConnection: (ds: DataSource) => Promise<{ success: boolean; message: string }>;
  loadSchema: (
    dataSourceId: string,
    useCache?: boolean,
    mergeWithExisting?: boolean,
    filterEmptyTables?: boolean,
    filterNoCommentTables?: boolean
  ) => Promise<void>;
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
  setFilterNoCommentTables: (value: boolean) => void;
  setFilterRules: (rules: string[]) => void;
  toggleFieldUsed: (dataSourceId: string, tableName: string, columnName: string, used: boolean) => void;
  getUsedFields: (dataSourceId: string, tableName: string) => Set<string>;
  setShowOnlyUsedFieldsByTable: (tableKey: string, value: boolean) => void;
  getShowOnlyUsedFieldsByTable: (tableKey: string) => boolean;
  setColumnSearchTerm: (value: string) => void;
  toggleSidebar: () => void;
  toggleTableList: () => void;
  saveQueryConditionTemplate: (
    name: string,
    tableName: string,
    columns: string[],
    operators: string[],
    joins?: SavedConditionJoin[]
  ) => void;
  deleteQueryConditionTemplate: (id: string) => void;
  getQueryConditionTemplatesForTable: (tableName: string) => SavedQueryConditionTemplate[];
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
      filterEmptyTables: true,
      filterNoCommentTables: true,
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

      loadSchema: async (dataSourceId, useCache = true, mergeWithExisting = false, filterEmptyTables = false, filterNoCommentTables = true) => {
      const controller = new AbortController();
      const currentSchema = [...get().schema];
      set({ schemaLoading: true, schemaError: null, abortController: controller, schemaProgress: null });

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

        const schema = await window.electronAPI.getSchema(
          dataSourceId,
          ownerFilter,
          tableNamePattern,
          useCache,
          filterEmptyTables,
          mergeWithExisting,
          filterNoCommentTables
        );

        if (controller.signal.aborted) {
          set({ schema: currentSchema, schemaLoading: false, abortController: null, schemaProgress: null });
          return;
        }

        // 增量更新时主进程已合并全量缓存；此处再用正则过滤会误删未匹配的旧表，导致侧栏只剩本次子集
        let filteredSchema = schema;
        if (schemaFilterPattern && !mergeWithExisting) {
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
          columns: table.columns.map((col: TableColumn) => ({
            ...col,
            isUsed: col.isUsed ?? (col.hasData && !col.isPrimaryKey),
          })),
        }));

        set({
          schema: processedSchema,
          schemaLoading: false,
          abortController: null,
          schemaProgress: null,
          lastSchemaUpdate: new Date(),
        });
      } catch (error) {
        if ((error as Error).message === 'Operation cancelled' || controller.signal.aborted) {
          set({ schema: currentSchema, schemaLoading: false, abortController: null, schemaProgress: null });
          return;
        }
        console.error('Failed to load schema:', error);
        set({ schema: currentSchema, schemaLoading: false, schemaError: (error as Error).message, abortController: null, schemaProgress: null });
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
            columns: table.columns.map((col: TableColumn) => ({
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
        const key = tableName.trim().toUpperCase();
        set((state) => ({
          schema: state.schema.filter((t) => t.tableName.trim().toUpperCase() !== key),
        }));
        if (activeDataSource?.id) {
          await window.electronAPI.removeTableFromCache(activeDataSource.id, tableName);
        }
      },

      removeTables: async (tableNames: string[]) => {
        const { activeDataSource } = get();
        const keySet = new Set(tableNames.map((n) => n.trim().toUpperCase()));
        set((state) => ({
          schema: state.schema.filter((t) => !keySet.has(t.tableName.trim().toUpperCase())),
        }));
        if (activeDataSource?.id) {
          await window.electronAPI.removeTablesFromCache(activeDataSource.id, tableNames);
        }
      },

      refreshSchema: async (dataSourceId?: string) => {
        const { activeDataSource, filterEmptyTables, filterNoCommentTables } = get();
        const id = dataSourceId || activeDataSource?.id;
        if (id) {
          await get().loadSchema(id, false, false, filterEmptyTables, filterNoCommentTables);
        }
      },

      refreshSchemaWithMerge: async (dataSourceId?: string) => {
        const { activeDataSource, filterEmptyTables, filterNoCommentTables } = get();
        const id = dataSourceId || activeDataSource?.id;
        if (id) {
          await get().loadSchema(id, false, true, filterEmptyTables, filterNoCommentTables);
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
      set({ schemaLoading: false, abortController: null, schemaProgress: null });
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

    setFilterNoCommentTables: (value) => {
      set({ filterNoCommentTables: value });
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
        const value = get().showOnlyUsedFieldsByTable[tableKey];
        return value !== undefined ? value : true;
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

      saveQueryConditionTemplate: (name, tableName, columns, operators, joins) => {
        const template: SavedQueryConditionTemplate = {
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name,
          tableName,
          columns,
          operators,
          ...(joins && joins.length > 0 ? { joins } : {}),
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
        filterNoCommentTables: state.filterNoCommentTables,
      }),
    }
  )
);
