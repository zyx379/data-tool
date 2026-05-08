import { useState, useEffect, useMemo } from 'react';
import DataSources from './DataSources';
import { useDataSourceStore, TableInfo, TableColumn } from '../stores/dataSourceStore';

interface TablesByOwner {
  [owner: string]: TableInfo[];
}

interface QueryCondition {
  columnName: string;
  operator: string;
  value: string;
}

interface SortCondition {
  columnName: string;
  order: 'ASC' | 'DESC';
}

interface OpenTab {
  tableName: string;
  tableInfo: TableInfo;
}

function Schema() {
  const [showDatasources, setShowDatasources] = useState(false);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'columns' | 'indexes' | 'query'>('columns');
  const [searchTerm, setSearchTerm] = useState('');
  const [queryConditions, setQueryConditions] = useState<Record<string, QueryCondition[]>>({});
  const [sortConditions, setSortConditions] = useState<Record<string, SortCondition[]>>({});
  const [queryResults, setQueryResults] = useState<Record<string, { columns: string[]; rows: any[][] } | null>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [showColumnNamesInChinese, setShowColumnNamesInChinese] = useState(false);
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tableName: string } | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [showSaveConditionModal, setShowSaveConditionModal] = useState(false);
  const [savedConditionName, setSavedConditionName] = useState('');
  const [hasAutoAddedDefaultFields, setHasAutoAddedDefaultFields] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tableName: string; index: number } | null>(null);
  const [ownerContextMenu, setOwnerContextMenu] = useState<{ x: number; y: number; owner: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'table' | 'owner'; name: string; tableNames?: string[] } | null>(null);

  const toggleOwner = (owner: string) => {
    setExpandedOwners(prev => {
      const newSet = new Set(prev);
      if (newSet.has(owner)) {
        newSet.delete(owner);
      } else {
        newSet.add(owner);
      }
      return newSet;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tableName });
  };

  const handleDeleteTable = () => {
    if (contextMenu) {
      setDeleteTarget({ type: 'table', name: contextMenu.tableName });
      setShowDeleteConfirm(true);
      closeContextMenu();
    }
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleTabContextMenu = (e: React.MouseEvent, tableName: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ x: e.clientX, y: e.clientY, tableName, index });
  };

  const closeTabContextMenu = () => {
    setTabContextMenu(null);
  };

  const closeAllTabs = () => {
    setOpenTabs([]);
    setActiveTabKey(null);
    closeTabContextMenu();
  };

  const closeOtherTabs = () => {
    if (tabContextMenu) {
      const newTabs = openTabs.filter((_, idx) => idx === tabContextMenu.index);
      setOpenTabs(newTabs);
      setActiveTabKey(newTabs.length > 0 ? newTabs[0].tableName : null);
      closeTabContextMenu();
    }
  };

  const closeLeftTabs = () => {
    if (tabContextMenu) {
      const newTabs = openTabs.filter((_, idx) => idx >= tabContextMenu.index);
      setOpenTabs(newTabs);
      setActiveTabKey(newTabs.length > 0 ? newTabs[0].tableName : null);
      closeTabContextMenu();
    }
  };

  const closeRightTabs = () => {
    if (tabContextMenu) {
      const newTabs = openTabs.filter((_, idx) => idx <= tabContextMenu.index);
      setOpenTabs(newTabs);
      setActiveTabKey(newTabs.length > 0 ? newTabs[newTabs.length - 1].tableName : null);
      closeTabContextMenu();
    }
  };

  const handleOwnerContextMenu = (e: React.MouseEvent, owner: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOwnerContextMenu({ x: e.clientX, y: e.clientY, owner });
  };

  const closeOwnerContextMenu = () => {
    setOwnerContextMenu(null);
  };

  const removeAllTablesInOwner = () => {
    if (ownerContextMenu) {
      const ownerTables = schema.filter(table => table.owner === ownerContextMenu.owner);
      const tableNames = ownerTables.map(t => t.tableName);
      setDeleteTarget({ type: 'owner', name: ownerContextMenu.owner, tableNames });
      setShowDeleteConfirm(true);
      closeOwnerContextMenu();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    
    if (deleteTarget.type === 'table') {
      await removeTable(deleteTarget.name);
    } else if (deleteTarget.type === 'owner' && deleteTarget.tableNames) {
      await removeTables(deleteTarget.tableNames);
    }
    
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
  };

  const saveCurrentQueryConditions = () => {
    if (!activeTabKey || !savedConditionName.trim()) return;
    
    const conditions = queryConditions[activeTabKey] || [];
    if (conditions.length === 0) {
      alert('没有查询条件可保存');
      return;
    }

    const columns = conditions.map(c => c.columnName);
    const operators = conditions.map(c => c.operator);
    
    saveQueryConditionTemplate(savedConditionName.trim(), activeTabKey, columns, operators);
    setSavedConditionName('');
    setShowSaveConditionModal(false);
  };

  const loadQueryConditionTemplate = (template: any) => {
    if (!activeTabKey) return;
    
    const newConditions = template.columns.map((col: string, idx: number) => ({
      columnName: col,
      operator: template.operators[idx] || '=',
      value: ''
    }));
    
    setQueryConditions({
      ...queryConditions,
      [activeTabKey]: newConditions
    });
  };

  const handleDeleteQueryTemplate = (templateId: string) => {
    deleteQueryConditionTemplate(templateId);
  };

  const autoAddDefaultFields = (tableName: string, columns: TableColumn[]) => {
    const eventNoCol = columns.find(c => c.columnName === 'EVENT_NO');
    const patientIdCol = columns.find(c => c.columnName === 'PATIENT_ID');
    
    const newConditions: QueryCondition[] = [];
    
    if (eventNoCol) {
      newConditions.push({ columnName: 'EVENT_NO', operator: '=', value: '' });
    }
    if (patientIdCol) {
      newConditions.push({ columnName: 'PATIENT_ID', operator: '=', value: '' });
    }
    
    if (newConditions.length > 0) {
      const currentConditions = queryConditions[tableName] || [];
      const existingColumns = new Set(currentConditions.map(c => c.columnName));
      const filteredNewConditions = newConditions.filter(c => !existingColumns.has(c.columnName));
      
      if (filteredNewConditions.length > 0) {
        setQueryConditions({
          ...queryConditions,
          [tableName]: [...currentConditions, ...filteredNewConditions]
        });
      }
    }
  };

  useEffect(() => {
    const handleClick = () => {
      closeContextMenu();
      closeTabContextMenu();
      closeOwnerContextMenu();
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const {
    dataSources,
    activeDataSource,
    schema,
    schemaLoading,
    schemaError,
    loadDataSources,
    loadSchema,
    loadSchemaFromCache,
    setActiveDataSource,
    refreshSchema,
    refreshSchemaWithMerge,
    cancelSchemaLoad,
    schemaFilterPattern,
    schemaFilterHistory,
    setSchemaFilterPattern,
    addSchemaFilterHistory,
    schemaProgress,
    setSchemaProgress,
    filterEmptyTables,
    setFilterEmptyTables,
    toggleFieldUsed,
    getUsedFields,
    setShowOnlyUsedFieldsByTable,
    getShowOnlyUsedFieldsByTable,
    setColumnSearchTerm,
    sidebarCollapsed,
    tableListCollapsed,
    toggleSidebar,
    toggleTableList,
    removeTable,
    removeTables,
    saveQueryConditionTemplate,
    deleteQueryConditionTemplate,
    getQueryConditionTemplatesForTable,
  } = useDataSourceStore();

  useEffect(() => {
    if (window.electronAPI?.onSchemaProgress) {
      const unsubscribe = window.electronAPI.onSchemaProgress((progress) => {
        setSchemaProgress(progress);
      });
      return unsubscribe;
    }
  }, [setSchemaProgress]);

  useEffect(() => {
    loadDataSources();
  }, [loadDataSources]);

  useEffect(() => {
    if (activeDataSource?.id && schema.length === 0) {
      loadSchemaFromCache(activeDataSource.id);
    }
  }, [activeDataSource, schema.length, loadSchemaFromCache]);

  useEffect(() => {
    setHasAutoAddedDefaultFields(false);
  }, [activeTabKey]);

  const filteredTables = schema.filter((table) => {
    if (!searchTerm) return true;
    return (
      table.tableName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      table.comments.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const handleDataSourceChange = async (dsId: string) => {
    await setActiveDataSource(dsId);
    setOpenTabs([]);
    setActiveTabKey(null);
    await loadSchema(dsId, true);
  };

  const openTable = (table: TableInfo) => {
    const existingTab = openTabs.find(tab => tab.tableName === table.tableName);
    if (existingTab) {
      setActiveTabKey(table.tableName);
      return;
    }
    const newTab: OpenTab = {
      tableName: table.tableName,
      tableInfo: table
    };
    setOpenTabs([...openTabs, newTab]);
    setActiveTabKey(table.tableName);
  };

  const closeTab = (tableName: string) => {
    const newTabs = openTabs.filter(tab => tab.tableName !== tableName);
    setOpenTabs(newTabs);
    if (activeTabKey === tableName) {
      setActiveTabKey(newTabs.length > 0 ? newTabs[newTabs.length - 1].tableName : null);
    }
  };

  const getTableColumns = (table: TableInfo) => {
    let columns = table.columns;
    
    if (useDataSourceStore.getState().columnSearchTerm) {
      const searchLower = useDataSourceStore.getState().columnSearchTerm.toLowerCase();
      columns = columns.filter(
        (col) => 
          col.columnName.toLowerCase().includes(searchLower) ||
          col.comments.toLowerCase().includes(searchLower)
      );
    }
    
    if (activeDataSource?.id) {
      const tableKey = `${activeDataSource.id}_${table.tableName}`;
      if (getShowOnlyUsedFieldsByTable(tableKey)) {
        const usedFieldsSet = getUsedFields(activeDataSource.id, table.tableName);
        columns = columns.filter((col) => col.isUsed || usedFieldsSet.has(col.columnName));
      }
    }
    
    return columns;
  };

  const getUsedColumns = (table: TableInfo) => {
    if (!activeDataSource?.id) return [];
    const usedFieldsSet = getUsedFields(activeDataSource.id, table.tableName);
    return table.columns.filter(col => col.isUsed || usedFieldsSet.has(col.columnName));
  };

  const addQueryCondition = (tableName: string, columnName: string) => {
    const currentConditions = queryConditions[tableName] || [];
    setQueryConditions({
      ...queryConditions,
      [tableName]: [...currentConditions, { columnName, operator: '=', value: '' }]
    });
  };

  const removeQueryCondition = (tableName: string, index: number) => {
    const currentConditions = queryConditions[tableName] || [];
    setQueryConditions({
      ...queryConditions,
      [tableName]: currentConditions.filter((_, i) => i !== index)
    });
  };

  const updateQueryCondition = (tableName: string, index: number, field: keyof QueryCondition, value: string) => {
    const currentConditions = queryConditions[tableName] || [];
    const newConditions = [...currentConditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setQueryConditions({
      ...queryConditions,
      [tableName]: newConditions
    });
  };

  const addSortCondition = (tableName: string, columnName: string) => {
    const currentConditions = sortConditions[tableName] || [];
    setSortConditions({
      ...sortConditions,
      [tableName]: [...currentConditions, { columnName, order: 'ASC' }]
    });
  };

  const removeSortCondition = (tableName: string, index: number) => {
    const currentConditions = sortConditions[tableName] || [];
    setSortConditions({
      ...sortConditions,
      [tableName]: currentConditions.filter((_, i) => i !== index)
    });
  };

  const updateSortCondition = (tableName: string, index: number, field: keyof SortCondition, value: string) => {
    const currentConditions = sortConditions[tableName] || [];
    const newConditions = [...currentConditions];
    newConditions[index] = { ...newConditions[index], [field]: value as any };
    setSortConditions({
      ...sortConditions,
      [tableName]: newConditions
    });
  };

  const generateSQL = (table: TableInfo, tableName: string) => {
    const showOnlyUsed = activeDataSource?.id ? getShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${tableName}`) : false;
    const usedColumns = getUsedColumns(table);
    
    let selectColumns: string;
    if (showOnlyUsed) {
      selectColumns = usedColumns.length > 0 ? usedColumns.map(c => c.columnName).join(', ') : '*';
    } else {
      selectColumns = '*';
    }
    
    let sql = `SELECT ${selectColumns} FROM ${table.tableName}`;
    
    const conditions = queryConditions[tableName] || [];
    if (conditions.length > 0) {
      const whereClauses = conditions.map(c => {
        if (c.operator === 'LIKE') {
          return `${c.columnName} LIKE '%${c.value}%'`;
        }
        if (c.operator === 'IN') {
          return `${c.columnName} IN (${c.value})`;
        }
        if (c.operator === 'IS NULL' || c.operator === 'IS NOT NULL') {
          return `${c.columnName} ${c.operator}`;
        }
        return `${c.columnName} ${c.operator} '${c.value}'`;
      });
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    
    const sorts = sortConditions[tableName] || [];
    if (sorts.length > 0) {
      const orderClauses = sorts.map(s => `${s.columnName} ${s.order}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    
    return sql;
  };

  const exportSQL = (table: TableInfo, tableName: string) => {
    const sql = generateSQL(table, tableName);
    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.tableName}_query_${Date.now()}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = (table: TableInfo, tableName: string) => {
    const results = queryResults[tableName];
    if (!results || results.rows.length === 0) {
      alert('没有数据可以导出，请先执行查询');
      return;
    }
    
    const csvContent = [
      results.columns.join(','),
      ...results.rows.map(row => row.map(cell => {
        const str = String(cell || '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.tableName}_data_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeQuery = async (table: TableInfo, tableName: string) => {
    if (!activeDataSource?.id) return;
    
    // 执行查询时默认收缩左侧菜单和表列表
    if (!sidebarCollapsed) toggleSidebar();
    if (!tableListCollapsed) toggleTableList();
    
    setIsExecuting(true);
    setQueryResults({
      ...queryResults,
      [tableName]: null
    });
    
    try {
      const sql = generateSQL(table, tableName);
      const results = await window.electronAPI.executeQuery(activeDataSource.id, sql);
      setQueryResults({
        ...queryResults,
        [tableName]: results
      });
    } catch (error) {
      alert('查询错误：' + (error as Error).message);
    } finally {
      setIsExecuting(false);
    }
  };

  const getColumnDisplayName = (column: TableColumn) => {
    if (showColumnNamesInChinese && column.comments) {
      return column.comments;
    }
    return column.columnName;
  };

  return (
    <div className="flex flex-1">
      {/* 左侧导航栏 */}
      <div className={`${sidebarCollapsed ? 'w-14' : 'w-56'} bg-gradient-to-b from-slate-50 to-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm`}>
        {/* 头部 */}
        <div className="px-2 py-2 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-100 to-slate-50">
          {!sidebarCollapsed && (
            <h1 className="text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              zoehis-helper
            </h1>
          )}
          <button 
            onClick={toggleSidebar} 
            className="p-1 hover:bg-slate-200 rounded-full transition-all duration-200 text-slate-500 hover:text-slate-700"
            title={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
          >
            {sidebarCollapsed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>
        
        {/* 导航菜单 */}
        <nav className="flex-1 py-2 px-1 space-y-1">
          <button
            onClick={() => setShowDatasources(false)}
            className={`w-full flex items-center ${!sidebarCollapsed ? 'justify-start space-x-2 pl-2' : 'justify-center'} py-2 rounded-lg transition-all duration-200 ${
              !showDatasources 
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200' 
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="text-lg">📊</span>
            {!sidebarCollapsed && <span className="font-medium text-sm">数据查询</span>}
          </button>
          
          <button
            onClick={() => setShowDatasources(true)}
            className={`w-full flex items-center ${!sidebarCollapsed ? 'justify-start space-x-2 pl-2' : 'justify-center'} py-2 rounded-lg transition-all duration-200 ${
              showDatasources 
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200' 
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="text-lg">🔌</span>
            {!sidebarCollapsed && <span className="font-medium text-sm">数据源管理</span>}
          </button>
        </nav>
      </div>

      {showDatasources ? (
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          <DataSources />
        </div>
      ) : (
        <div className="flex-1 flex">
          {/* 表列表 */}
          <div className={`${tableListCollapsed ? 'w-14' : 'w-80'} bg-gradient-to-b from-white to-slate-50 border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm`}>
            <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-white">
              {!tableListCollapsed && (
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      表列表
                    </span>
                    <div className="flex items-center gap-2">
                      {schemaLoading ? (
                        <button
                          onClick={cancelSchemaLoad}
                          className="p-1 hover:bg-red-100 rounded-full transition-all duration-200 text-red-400 hover:text-red-600"
                          title="取消加载"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowRefreshModal(true)}
                          disabled={!activeDataSource?.id}
                          className="p-1 hover:bg-slate-100 rounded-full transition-all duration-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="加载/刷新表结构"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      )}
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredTables.length} / {schema.length}</span>
                    </div>
                  </div>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="搜索表名或注释..."
                      value={searchTerm}
                      onChange={(e) => {
                        const newTerm = e.target.value;
                        setSearchTerm(newTerm);
                        if (newTerm && schema.length > 0) {
                          const termLower = newTerm.toLowerCase();
                          const matchedOwners = new Set<string>();
                          schema.forEach(table => {
                            if (
                              table.tableName.toLowerCase().includes(termLower) ||
                              table.comments.toLowerCase().includes(termLower)
                            ) {
                              if (table.owner) {
                                matchedOwners.add(table.owner);
                              }
                            }
                          });
                          setExpandedOwners(matchedOwners);
                        } else {
                          setExpandedOwners(new Set());
                        }
                      }}
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-slate-50 focus:bg-white"
                    />
                  </div>
                </div>
              )}
              <button 
                onClick={toggleTableList} 
                className="p-1.5 hover:bg-slate-100 rounded-full transition-all duration-200 text-slate-500 hover:text-slate-700 hover:shadow-md ml-1"
                title={tableListCollapsed ? '展开表列表' : '收起表列表'}
              >
                {tableListCollapsed ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                )}
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2">
              {!tableListCollapsed && (
                <>
                  {schemaLoading ? (
                    <div className="p-4">
                      <div className="text-center text-slate-500 mb-3">
                        <svg className="w-6 h-6 mx-auto mb-2 animate-spin text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <p className="text-sm font-medium">{schemaProgress?.phase === 'loading' ? '正在获取表列表...' : '正在加载表结构...'}</p>
                      </div>
                      {schemaProgress && schemaProgress.total > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-xs text-slate-400 mb-1">
                            <span className="truncate max-w-xs font-mono">{schemaProgress.currentTable}</span>
                            <span>{schemaProgress.current} / {schemaProgress.total}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(schemaProgress.current / schemaProgress.total) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={cancelSchemaLoad}
                        className="w-full mt-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        取消加载
                      </button>
                    </div>
                  ) : schemaError ? (
                    <div className="p-6 text-center text-red-400 bg-red-50 rounded-lg border border-red-100">
                      <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {schemaError}
                    </div>
                  ) : filteredTables.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      没有匹配的表
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {(() => {
                        const groupedTables = filteredTables.reduce((acc, table) => {
                          const owner = table.owner || 'UNKNOWN';
                          if (!acc[owner]) {
                            acc[owner] = [];
                          }
                          acc[owner].push(table);
                          return acc;
                        }, {} as TablesByOwner);

                        const owners = Object.keys(groupedTables).sort();

                        return owners.map(owner => {
                          const tables = groupedTables[owner];
                          const isExpanded = expandedOwners.has(owner);
                          const hasOpenTable = tables.some(table => openTabs.some(tab => tab.tableName === table.tableName));

                          return (
                            <div key={owner} className="mb-2">
                              <div
                                onClick={() => toggleOwner(owner)}
                                onContextMenu={(e) => handleOwnerContextMenu(e, owner)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 ${
                                  hasOpenTable 
                                    ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200' 
                                    : 'hover:bg-slate-100 border border-transparent hover:border-slate-200'
                                }`}
                              >
                                <svg
                                  className={`w-4 h-4 transition-transform duration-200 ${
                                    isExpanded ? 'rotate-90 text-blue-500' : 'text-slate-400'
                                  }`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className={`font-semibold text-sm ${hasOpenTable ? 'text-blue-700' : 'text-slate-700'}`}>
                                  {owner}
                                </span>
                                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full ml-auto">
                                  {tables.length}
                                </span>
                              </div>

                              {isExpanded && (
                                <div className="ml-4 mt-1 space-y-1">
                                  {tables.map(table => {
                                    const isOpen = openTabs.some(tab => tab.tableName === table.tableName);
                                    const tableNameOnly = table.tableName.split('.').pop() || table.tableName;

                                    return (
                                      <div
                                        key={table.tableName}
                                        onClick={() => openTable(table)}
                                        onContextMenu={(e) => handleContextMenu(e, table.tableName)}
                                        className={`px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 group ${
                                          isOpen 
                                            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 shadow-sm' 
                                            : 'hover:bg-slate-50 border border-transparent hover:border-slate-200'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className={`font-mono text-xs font-medium ${isOpen ? 'text-blue-700' : 'text-slate-700'}`}>
                                            {tableNameOnly}
                                          </span>
                                          {isOpen && (
                                            <span className="flex items-center gap-1.5">
                                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                            </span>
                                          )}
                                        </div>
                                        {table.comments && (
                                          <div className={`text-xs ${isOpen ? 'text-blue-500' : 'text-slate-400'} line-clamp-1`}>
                                            {table.comments}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 bg-gradient-to-br from-slate-50 via-white to-slate-50 flex flex-col overflow-hidden">
            {openTabs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-700 mb-1">选择一个表开始</h3>
                  <p className="text-slate-400 text-sm">点击左侧表格查看表详情</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 标签页栏 */}
                <div className="bg-white border-b border-slate-200 flex items-center overflow-x-auto shadow-sm">
                  {openTabs.map((tab, index) => (
                    <div
                      key={tab.tableName}
                      className={`flex items-center px-4 py-3 cursor-pointer min-w-max transition-all duration-200 group border-r border-slate-100 last:border-r-0 ${
                        activeTabKey === tab.tableName 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border-b-2 border-blue-500' 
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                      }`}
                      onClick={() => setActiveTabKey(tab.tableName)}
                      onContextMenu={(e) => handleTabContextMenu(e, tab.tableName, index)}
                    >
                      <span className="text-sm font-medium mr-2.5">{tab.tableInfo.comments || tab.tableName}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.tableName);
                        }}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-0.5 rounded-full hover:bg-slate-200 ${activeTabKey === tab.tableName ? 'opacity-100 hover:bg-blue-200' : ''}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* 内容区域 */}
                {activeTabKey && (() => {
                  const activeTable = openTabs.find(tab => tab.tableName === activeTabKey);
                  if (!activeTable) return null;
                  
                  return (
                    <div className="flex-1 flex flex-col overflow-hidden p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-xl font-bold text-slate-800">{activeTable.tableInfo.tableName}</h2>
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full border border-slate-200">
                              {activeTable.tableInfo.columns.length} 列
                            </span>
                          </div>
                          {activeTable.tableInfo.comments && (
                            <p className="text-slate-500 text-sm">{activeTable.tableInfo.comments}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <select
                            value={activeDataSource?.id || ''}
                            onChange={(e) => handleDataSourceChange(e.target.value)}
                            className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 shadow-sm"
                          >
                            <option value="">选择数据源</option>
                            {dataSources.map((ds) => (
                              <option key={ds.id} value={ds.id}>
                                {ds.name} ({ds.type})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex space-x-1 mb-6 p-1 bg-slate-100 rounded-xl">
                        <button
                          onClick={() => setActiveSubTab('columns')}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                            activeSubTab === 'columns' 
                              ? 'bg-white text-blue-600 shadow-sm' 
                              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                            </svg>
                            列信息 ({getTableColumns(activeTable.tableInfo).length})
                          </span>
                        </button>
                        {activeTable.tableInfo.indexes.length > 0 && (
                          <button
                            onClick={() => setActiveSubTab('indexes')}
                            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                              activeSubTab === 'indexes' 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                              </svg>
                              索引信息 ({activeTable.tableInfo.indexes.length})
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setActiveSubTab('query');
                            if (!hasAutoAddedDefaultFields && activeTabKey) {
                              const activeTable = openTabs.find(tab => tab.tableName === activeTabKey);
                              if (activeTable) {
                                autoAddDefaultFields(activeTabKey, activeTable.tableInfo.columns);
                                setHasAutoAddedDefaultFields(true);
                              }
                            }
                          }}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                            activeSubTab === 'query' 
                              ? 'bg-white text-blue-600 shadow-sm' 
                              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            数据查询
                          </span>
                        </button>
                      </div>

                      {activeSubTab === 'columns' && (
                        <div className="flex-1 flex flex-col overflow-hidden">
                          <div className="mb-4 p-3 bg-white rounded-lg flex items-center space-x-4 flex-shrink-0">
                            <input
                              type="text"
                              placeholder="搜索列名或注释"
                              value={useDataSourceStore.getState().columnSearchTerm}
                              onChange={(e) => setColumnSearchTerm(e.target.value)}
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            {activeDataSource?.id && (
                              <label className="flex items-center space-x-2 cursor-pointer whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={getShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${activeTable.tableName}`)}
                                  onChange={(e) => setShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${activeTable.tableName}`, e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm">仅显示已标记字段</span>
                        </label>
                      )}
                    </div>

                    <div className="flex-1 overflow-auto bg-white rounded-lg shadow">
                      <table className="min-w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">字段使用</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">列名</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">注释</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">类型</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">可空</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">默认值</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {getTableColumns(activeTable.tableInfo).map((col) => {
                            const usedFieldsSet = activeDataSource?.id ? getUsedFields(activeDataSource.id, activeTable.tableName) : new Set();
                            const isUsed = col.isUsed || usedFieldsSet.has(col.columnName);

                            return (
                              <tr key={col.columnName} className={`hover:bg-gray-50 ${isUsed ? 'bg-green-50' : ''}`}>
                                <td className="px-3 py-2">
                                  {activeDataSource?.id && (
                                    <input
                                      type="checkbox"
                                      checked={isUsed}
                                      onChange={(e) => {
                                        toggleFieldUsed(activeDataSource.id, activeTable.tableName, col.columnName, e.target.checked);
                                      }}
                                      className="rounded"
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-sm">
                                  {col.isPrimaryKey && <span className="text-red-500 mr-1" title="主键">🔑</span>}
                                  {col.columnName}
                                </td>
                                <td className="px-3 py-2 text-sm">{col.comments}</td>
                                <td className="px-3 py-2 font-mono text-sm">{col.dataType}</td>
                                <td className="px-3 py-2 text-sm">{col.nullable}</td>
                                <td className="px-3 py-2 text-sm">{col.dataDefault || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeSubTab === 'indexes' && activeTable.tableInfo.indexes.length > 0 && (
                  <div className="flex-1 overflow-auto bg-white rounded-lg shadow">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">索引名</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">列名</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">类型</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">唯一性</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {activeTable.tableInfo.indexes.map((idx) => (
                          <tr key={idx.indexName} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-sm">{idx.indexName}</td>
                            <td className="px-3 py-2 font-mono text-sm">{idx.columnName}</td>
                            <td className="px-3 py-2 text-sm">{idx.indexType}</td>
                            <td className="px-3 py-2 text-sm">{idx.uniqueness}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeSubTab === 'query' && (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-shrink-0 bg-gradient-to-br from-slate-50 to-white border-b border-slate-200 overflow-x-auto">
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center space-x-4">
                            <label className="flex items-center space-x-2 cursor-pointer whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={showColumnNamesInChinese}
                                onChange={(e) => setShowColumnNamesInChinese(e.target.checked)}
                                className="rounded"
                              />
                              <span className="text-sm">列名显示中文</span>
                            </label>
                          </div>

                          {activeTabKey && (() => {
                            const savedTemplates = getQueryConditionTemplatesForTable(activeTabKey);
                            return savedTemplates.length > 0 ? (
                              <div className="flex items-center space-x-2">
                                <span className="text-xs text-gray-500">已保存条件:</span>
                                {savedTemplates.map(template => (
                                  <button
                                    key={template.id}
                                    onClick={() => loadQueryConditionTemplate(template)}
                                    className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded hover:bg-blue-200 transition-colors"
                                    title={template.columns.join(', ')}
                                  >
                                    {template.name}
                                  </button>
                                ))}
                              </div>
                            ) : null;
                          })()}

                          <div className="flex items-center space-x-2 ml-auto">
                            <button
                              onClick={() => executeQuery(activeTable.tableInfo, activeTable.tableName)}
                              disabled={isExecuting}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium text-sm"
                            >
                              {isExecuting ? '执行中...' : '执行查询'}
                            </button>
                            <button onClick={() => exportSQL(activeTable.tableInfo, activeTable.tableName)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors">导出 SQL</button>
                            <button onClick={() => exportExcel(activeTable.tableInfo, activeTable.tableName)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors">导出 Excel</button>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 whitespace-nowrap">查询条件:</span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {(queryConditions[activeTable.tableName] || []).map((condition, index) => {
                                const column = activeTable.tableInfo.columns.find(c => c.columnName === condition.columnName);
                                return (
                                  <div key={index} className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1">
                                    <span className="font-mono text-xs whitespace-nowrap">{column ? getColumnDisplayName(column) : condition.columnName}</span>
                                    <select
                                      value={condition.operator}
                                      onChange={(e) => updateQueryCondition(activeTable.tableName, index, 'operator', e.target.value)}
                                      className="border-0 text-xs py-0 px-1 bg-transparent"
                                    >
                                      <option value="=">=</option>
                                      <option value="!=">!=</option>
                                      <option value=">">&gt;</option>
                                      <option value=">=">&gt;=</option>
                                      <option value="<">&lt;</option>
                                      <option value="<=">&lt;=</option>
                                      <option value="LIKE">LIKE</option>
                                      <option value="IN">IN</option>
                                      <option value="IS NULL">NULL</option>
                                      <option value="IS NOT NULL">NOT NULL</option>
                                    </select>
                                    {condition.operator !== 'IS NULL' && condition.operator !== 'IS NOT NULL' && (
                                      <input
                                        type="text"
                                        value={condition.value}
                                        onChange={(e) => updateQueryCondition(activeTable.tableName, index, 'value', e.target.value)}
                                        placeholder="值"
                                        className="border-0 text-xs py-0 px-1 w-24 bg-transparent"
                                      />
                                    )}
                                    <button onClick={() => removeQueryCondition(activeTable.tableName, index)} className="text-red-500 hover:text-red-700 ml-1">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                );
                              })}
                              {getUsedColumns(activeTable.tableInfo).length > 0 && (
                                <select
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      addQueryCondition(activeTable.tableName, e.target.value);
                                      e.target.value = '';
                                    }
                                  }}
                                >
                                  <option value="">+ 添加</option>
                                  {getUsedColumns(activeTable.tableInfo).map(col => (
                                    <option key={col.columnName} value={col.columnName}>
                                      {getColumnDisplayName(col)}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {(queryConditions[activeTable.tableName] || []).length > 0 && (
                                <button
                                  onClick={() => setShowSaveConditionModal(true)}
                                  className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded hover:bg-green-200 transition-colors"
                                >
                                  保存
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-600 whitespace-nowrap">排序条件:</span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {(sortConditions[activeTable.tableName] || []).map((sort, index) => {
                                const column = activeTable.tableInfo.columns.find(c => c.columnName === sort.columnName);
                                return (
                                  <div key={index} className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1">
                                    <span className="font-mono text-xs whitespace-nowrap">{column ? getColumnDisplayName(column) : sort.columnName}</span>
                                    <select
                                      value={sort.order}
                                      onChange={(e) => updateSortCondition(activeTable.tableName, index, 'order', e.target.value)}
                                      className="border-0 text-xs py-0 px-1 bg-transparent"
                                    >
                                      <option value="ASC">↑ ASC</option>
                                      <option value="DESC">↓ DESC</option>
                                    </select>
                                    <button onClick={() => removeSortCondition(activeTable.tableName, index)} className="text-red-500 hover:text-red-700 ml-1">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                );
                              })}
                              {getUsedColumns(activeTable.tableInfo).length > 0 && (
                                <select
                                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      addSortCondition(activeTable.tableName, e.target.value);
                                      e.target.value = '';
                                    }
                                  }}
                                >
                                  <option value="">+ 添加</option>
                                  {getUsedColumns(activeTable.tableInfo).map(col => (
                                    <option key={col.columnName} value={col.columnName}>
                                      {getColumnDisplayName(col)}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden bg-white">
                      {queryResults[activeTable.tableName] ? (
                        <div className="h-full flex flex-col">
                          <div className="p-3 border-b border-slate-200 bg-gray-50 flex-shrink-0">
                            <h4 className="font-semibold text-gray-700 text-sm">
                              查询结果 ({queryResults[activeTable.tableName].rows.length} 条)
                              <span className="text-xs text-gray-400 ml-2 font-normal">
                                ({queryResults[activeTable.tableName].columns.length} 列)
                              </span>
                            </h4>
                          </div>
                          <div className="flex-1 overflow-auto">
                            <table className="min-w-full">
                              <thead className="bg-gray-100 sticky top-0 z-10">
                                <tr>
                                  {queryResults[activeTable.tableName].columns.map((col) => (
                                    <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap">
                                      {(activeTable.tableInfo.columns.find(c => c.columnName === col)?.comments && showColumnNamesInChinese) ? activeTable.tableInfo.columns.find(c => c.columnName === col)?.comments : col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {queryResults[activeTable.tableName].rows.slice(0, 100).map((row, index) => (
                                  <tr key={index} className="hover:bg-blue-50 transition-colors">
                                    {row.map((cell, i) => (
                                      <td key={i} className="px-3 py-2 text-xs border-b border-r border-gray-100 max-w-xs truncate" title={String(cell ?? '-')}>
                                        {cell !== null && cell !== undefined ? String(cell) : '-'}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {queryResults[activeTable.tableName].rows.length > 100 && (
                            <div className="p-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 text-center">
                              显示前100条结果，完整结果请导出Excel
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-400">
                          <div className="text-center">
                            <svg className="w-16 h-16 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            <p className="text-sm">点击"执行查询"查看数据</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {showRefreshModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-700">加载表结构</h3>
              <button
                onClick={() => setShowRefreshModal(false)}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-slate-600 mb-2">正则过滤表名</label>
              <input
                type="text"
                placeholder="如: ^T_|^ABC (留空加载全部)"
                value={schemaFilterPattern}
                onChange={(e) => {
                  const newPattern = e.target.value;
                  setSchemaFilterPattern(newPattern);
                  if (newPattern && schema.length > 0) {
                    try {
                      const regex = new RegExp(newPattern);
                      const matchedOwners = new Set<string>();
                      schema.forEach(table => {
                        if (regex.test(table.tableName)) {
                          if (table.owner) {
                            matchedOwners.add(table.owner);
                          }
                        }
                      });
                      setExpandedOwners(matchedOwners);
                    } catch {
                    }
                  }
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
                autoFocus
              />
              <label className="flex items-center space-x-2 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={filterEmptyTables}
                  onChange={(e) => setFilterEmptyTables(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-600">过滤表数据为空的表格</span>
              </label>
              {schemaFilterHistory.length > 0 && (
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-2">历史记录</label>
                  <div className="flex flex-wrap gap-2">
                    {schemaFilterHistory.map((pattern, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs font-mono text-slate-600 cursor-pointer hover:bg-slate-200"
                        onClick={() => setSchemaFilterPattern(pattern)}
                      >
                        <span>{pattern}</span>
                        <button
                          className="text-slate-400 hover:text-red-500 ml-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newHistory = schemaFilterHistory.filter((_, i) => i !== index);
                            useDataSourceStore.setState({ schemaFilterHistory: newHistory });
                          }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowRefreshModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (schema.length > 0) {
                    setShowOverwriteConfirm(true);
                  } else {
                    if (schemaFilterPattern) {
                      addSchemaFilterHistory(schemaFilterPattern);
                    }
                    refreshSchema();
                    setShowRefreshModal(false);
                  }
                }}
                disabled={schemaLoading}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 disabled:opacity-50 transition-colors"
              >
                {schemaLoading ? '加载中...' : '覆盖更新'}
              </button>
              <button
                onClick={() => {
                  if (schemaFilterPattern) {
                    addSchemaFilterHistory(schemaFilterPattern);
                  }
                  refreshSchemaWithMerge();
                  setShowRefreshModal(false);
                }}
                disabled={schemaLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {schemaLoading ? '加载中...' : '增量更新'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveConditionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-700">保存查询条件</h3>
              <button
                onClick={() => {
                  setShowSaveConditionModal(false);
                  setSavedConditionName('');
                }}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-slate-600 mb-2">条件名称</label>
              <input
                type="text"
                placeholder="输入保存的条件名称"
                value={savedConditionName}
                onChange={(e) => setSavedConditionName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    saveCurrentQueryConditions();
                  }
                }}
              />
              <p className="text-xs text-slate-500 mt-2">
                将保存当前查询条件中的字段列，不包含具体的值
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowSaveConditionModal(false);
                  setSavedConditionName('');
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveCurrentQueryConditions}
                disabled={!savedConditionName.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-48"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleDeleteTable}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除表
          </button>
        </div>
      )}

      {tabContextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-48"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
        >
          <button
            onClick={() => {
              closeTab(tabContextMenu.tableName);
              closeTabContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            关闭标签
          </button>
          <div className="border-t border-slate-100 my-1"></div>
          <button
            onClick={closeOtherTabs}
            className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            关闭其他标签
          </button>
          <button
            onClick={closeLeftTabs}
            disabled={tabContextMenu.index === 0}
            className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            关闭左侧标签
          </button>
          <button
            onClick={closeRightTabs}
            disabled={tabContextMenu.index === openTabs.length - 1}
            className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            关闭右侧标签
          </button>
          <div className="border-t border-slate-100 my-1"></div>
          <button
            onClick={closeAllTabs}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
            关闭全部标签
          </button>
        </div>
      )}

      {ownerContextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-48"
          style={{ left: ownerContextMenu.x, top: ownerContextMenu.y }}
        >
          <button
            onClick={removeAllTablesInOwner}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除表空间下所有表
          </button>
        </div>
      )}

      {deleteTarget && showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4">
            <div className="flex items-center gap-4 p-4 border-b border-slate-200">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-700">确认删除</h3>
                <p className="text-sm text-slate-500">确定要删除吗？此操作不可撤销。</p>
              </div>
            </div>
            <div className="p-4">
              {deleteTarget.type === 'table' ? (
                <p className="text-sm text-slate-600">即将删除表：<span className="font-mono font-medium">{deleteTarget.name}</span></p>
              ) : (
                <p className="text-sm text-slate-600">即将删除表空间 <span className="font-medium">{deleteTarget.name}</span> 下的 {deleteTarget.tableNames?.length} 张表</p>
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showOverwriteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4">
            <div className="flex items-center gap-4 p-4 border-b border-slate-200">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-700">确认覆盖更新</h3>
                <p className="text-sm text-slate-500">此操作将替换当前所有表结构</p>
              </div>
            </div>
            <div className="p-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">
                  <strong>警告：</strong>覆盖更新将清除当前已加载的 {schema.length} 张表，并重新加载新的表结构。已打开的表标签页将保持打开状态，但可能无法正常工作。
                </p>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                建议使用「增量更新」功能，保留已存在的表结构，只添加新表。
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowOverwriteConfirm(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (schemaFilterPattern) {
                    addSchemaFilterHistory(schemaFilterPattern);
                  }
                  refreshSchema();
                  setShowRefreshModal(false);
                  setShowOverwriteConfirm(false);
                }}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Schema;
