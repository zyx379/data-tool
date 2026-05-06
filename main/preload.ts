import { contextBridge, ipcRenderer } from 'electron';

export interface SchemaProgress {
  current: number;
  total: number;
  currentTable: string;
  phase: 'loading' | 'processing' | 'complete' | 'error';
}

export interface ElectronAPI {
  getDataSources: () => Promise<any[]>;
  createDataSource: (ds: any) => Promise<any>;
  updateDataSource: (id: string, ds: any) => Promise<any>;
  deleteDataSource: (id: string) => Promise<void>;
  setActiveDataSource: (id: string) => Promise<void>;
  getActiveDataSource: () => Promise<any>;
  testConnection: (ds: any) => Promise<{ success: boolean; message: string }>;
  getQueryHistory: () => Promise<any[]>;
  clearQueryHistory: () => Promise<void>;
  getSchema: (dataSourceId: string, ownerFilter?: string) => Promise<any[]>;
  executeQuery: (dataSourceId: string, sql: string) => Promise<any>;
  onSchemaProgress: (callback: (progress: SchemaProgress) => void) => () => void;
}

const api: ElectronAPI = {
  getDataSources: () => ipcRenderer.invoke('db:getDataSources'),
  createDataSource: (ds) => ipcRenderer.invoke('db:createDataSource', ds),
  updateDataSource: (id, ds) => ipcRenderer.invoke('db:updateDataSource', id, ds),
  deleteDataSource: (id) => ipcRenderer.invoke('db:deleteDataSource', id),
  setActiveDataSource: (id) => ipcRenderer.invoke('db:setActiveDataSource', id),
  getActiveDataSource: () => ipcRenderer.invoke('db:getActiveDataSource'),
  testConnection: (ds) => ipcRenderer.invoke('db:testConnection', ds),
  getQueryHistory: () => ipcRenderer.invoke('db:getQueryHistory'),
  clearQueryHistory: () => ipcRenderer.invoke('db:clearQueryHistory'),
  getSchema: (dataSourceId, ownerFilter) => ipcRenderer.invoke('db:getSchema', dataSourceId, ownerFilter),
  executeQuery: (dataSourceId, sql) => ipcRenderer.invoke('db:executeQuery', dataSourceId, sql),
  onSchemaProgress: (callback) => {
    const handler = (_: any, progress: SchemaProgress) => callback(progress);
    ipcRenderer.on('schema:progress', handler);
    return () => ipcRenderer.removeListener('schema:progress', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
