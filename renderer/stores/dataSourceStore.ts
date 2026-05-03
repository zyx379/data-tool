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
  showOnlyUsedFieldsByTable: Record<string, boolean>; // 按表配置
  columnSearchTerm: string;
  sidebarCollapsed: boolean; // 左侧菜单收起状态
  tableListCollapsed: boolean; // 表列表收起状态
  loadDataSources: () => Promise<void>;
  createDataSource: (ds: Omit<DataSource, 'id'>) => Promise<DataSource>;
  updateDataSource: (id: string, ds: Partial<DataSource>) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  testConnection: (ds: DataSource) => Promise<{ success: boolean; message: string }>;
  loadSchema: (dataSourceId: string, useCache?: boolean) => Promise<void>;
  refreshSchema: () => Promise<void>;
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
      getSchema: (dataSourceId: string) => Promise<TableInfo[]>;
      executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
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
      showOnlyUsedFieldsByTable: {}, // 默认全部显示
      columnSearchTerm: '',
      sidebarCollapsed: false,
      tableListCollapsed: false,

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
        if (id) {
          await get().loadSchema(id, true);
        }
      },

      testConnection: async (ds) => {
        return await window.electronAPI.testConnection(ds);
      },

      loadSchema: async (dataSourceId, useCache = true) => {
        set({ schemaLoading: true, schemaError: null });
        
        try {
          const { cachedSchema } = get();
          
          if (useCache && cachedSchema[dataSourceId]) {
            console.log('Using cached schema for data source:', dataSourceId);
            set({
              schema: cachedSchema[dataSourceId].tables,
              schemaLoading: false,
              lastSchemaUpdate: new Date(cachedSchema[dataSourceId].updatedAt),
            });
            return;
          }

          const schema = await window.electronAPI.getSchema(dataSourceId);
          
          set((state) => ({
            schema,
            schemaLoading: false,
            lastSchemaUpdate: new Date(),
            cachedSchema: {
              ...state.cachedSchema,
              [dataSourceId]: {
                tables: schema,
                updatedAt: new Date().toISOString(),
              },
            },
          }));
        } catch (error) {
          console.error('Failed to load schema:', error);
          set({ schemaLoading: false, schemaError: (error as Error).message });
        }
      },

      refreshSchema: async () => {
        const { activeDataSource } = get();
        if (activeDataSource?.id) {
          await get().loadSchema(activeDataSource.id, false);
        }
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
        return get().showOnlyUsedFieldsByTable[tableKey] || false; // 默认全部显示
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
        cachedSchema: state.cachedSchema,
        usedFields: state.usedFields,
        showOnlyUsedFieldsByTable: state.showOnlyUsedFieldsByTable,
        columnSearchTerm: state.columnSearchTerm,
        sidebarCollapsed: state.sidebarCollapsed,
        tableListCollapsed: state.tableListCollapsed,
      }),
    }
  )
);
