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
  loadDataSources: () => Promise<void>;
  createDataSource: (ds: Omit<DataSource, 'id'>) => Promise<DataSource>;
  updateDataSource: (id: string, ds: Partial<DataSource>) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  testConnection: (ds: DataSource) => Promise<{ success: boolean; message: string }>;
  loadSchema: (dataSourceId: string, useCache?: boolean) => Promise<void>;
  refreshSchema: () => Promise<void>;
  refreshSchemaWithMerge: () => Promise<void>;
  cancelSchemaLoad: () => void;
  removeTable: (tableName: string) => void;
  setSchemaFilterPattern: (pattern: string) => void;
  addSchemaFilterHistory: (pattern: string) => void;
  setSchemaProgress: (progress: SchemaProgress | null) => void;
  setFilterRules: (rules: string[]) => void;
  toggleFieldUsed: (dataSourceId: string, tableName: string, columnName: string, used: boolean) => void;
  getUsedFields: (dataSourceId: string, tableName: string) => Set<string>;
  setShowOnlyUsedFieldsByTable: (tableKey: string, value: boolean) => void;
  getShowOnlyUsedFieldsByTable: (tableKey: string) => boolean;
  setColumnSearchTerm: (value: string) => void;
  toggleSidebar: () => void;
  toggleTableList: () => void;
}

declare global {
  interface Window {
    electronAPI: {
      getDataSources: () => Promise<DataSource[]>;
      createDataSource: (ds: any) => Promise<DataSource>;
      updateDataSource: (id: string, ds: any) => Promise<DataSource>;
      deleteDataSource: (id: string) => Promise<void>;
      setActiveDataSource: (id: string) => Promise<void>;
      getActiveDataSource: () => Promise<DataSource | null>;
      testConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
      getQueryHistory: () => Promise<any[]>;
      clearQueryHistory: () => Promise<void>;
      getSchema: (dataSourceId: string, ownerFilter?: string, tableNamePattern?: string, useCache?: boolean) => Promise<TableInfo[]>;
      executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
      onSchemaProgress: (callback: (progress: SchemaProgress) => void) => () => void;
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

      loadSchema: async (dataSourceId, useCache = true, mergeWithExisting = false) => {
        const controller = new AbortController();
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

          const schema = await window.electronAPI.getSchema(dataSourceId, ownerFilter, tableNamePattern, useCache);

          if (controller.signal.aborted) {
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
              // invalid regex, load all tables
            }
          }

          const processedSchema = filteredSchema.map(table => ({
            ...table,
            columns: table.columns.map(col => ({
              ...col,
              isUsed: col.isUsed ?? (col.hasData && !col.isPrimaryKey),
            })),
          }));

          set((state) => {
            let mergedTables = processedSchema;
            
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
          if (controller.signal.aborted) {
            set({ schemaLoading: false, abortController: null });
            return;
          }
          console.error('Failed to load schema:', error);
          set({ schemaLoading: false, schemaError: (error as Error).message, abortController: null });
        }
      },

      removeTable: (tableName: string) => {
        set((state) => ({
          schema: state.schema.filter(t => t.tableName !== tableName),
        }));
      },

      refreshSchema: async () => {
        const { activeDataSource } = get();
        if (activeDataSource?.id) {
          await get().loadSchema(activeDataSource.id, false);
        }
      },

      refreshSchemaWithMerge: async () => {
        const { activeDataSource } = get();
        if (activeDataSource?.id) {
          await get().loadSchema(activeDataSource.id, false, true);
        }
      },

      cancelSchemaLoad: () => {
        const { abortController } = get();
        if (abortController) {
          abortController.abort();
          set({ schemaLoading: false, abortController: null });
        }
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
      }),
    }
  )
);