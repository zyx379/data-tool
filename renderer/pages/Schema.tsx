import { useState, useEffect } from 'react';
import DataSources from './DataSources';
import { useDataSourceStore, TableInfo, TableColumn } from '../stores/dataSourceStore';

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
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'columns' | 'indexes' | 'query'>('columns');
  const [searchTerm, setSearchTerm] = useState('');
  const [queryConditions, setQueryConditions] = useState<Record<string, QueryCondition[]>>({});
  const [sortConditions, setSortConditions] = useState<Record<string, SortCondition[]>>({});
  const [queryResults, setQueryResults] = useState<Record<string, { columns: string[]; rows: any[][] } | null>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [showColumnNamesInChinese, setShowColumnNamesInChinese] = useState(false);

  const {
    dataSources,
    activeDataSource,
    schema,
    schemaLoading,
    schemaError,
    loadDataSources,
    setActiveDataSource,
    loadSchema,
    toggleFieldUsed,
    getUsedFields,
    setShowOnlyUsedFieldsByTable,
    getShowOnlyUsedFieldsByTable,
    setColumnSearchTerm,
    sidebarCollapsed,
    tableListCollapsed,
    toggleSidebar,
    toggleTableList,
  } = useDataSourceStore();

  useEffect(() => {
    loadDataSources();
  }, [loadDataSources]);

  useEffect(() => {
    if (activeDataSource?.id) {
      loadSchema(activeDataSource.id, true);
    }
  }, [activeDataSource, loadSchema]);

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
        columns = columns.filter((col) => usedFieldsSet.has(col.columnName));
      }
    }
    
    return columns;
  };

  const getUsedColumns = (table: TableInfo) => {
    if (!activeDataSource?.id) return [];
    const usedFieldsSet = getUsedFields(activeDataSource.id, table.tableName);
    return table.columns.filter(col => usedFieldsSet.has(col.columnName));
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
    const usedColumns = getUsedColumns(table);
    const selectColumns = usedColumns.length > 0 ? usedColumns.map(c => c.columnName).join(', ') : '*';
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
      <div className={`${sidebarCollapsed ? 'w-14' : 'w-64'} bg-gradient-to-b from-slate-50 to-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm`}>
        {/* 头部 */}
        <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-100 to-slate-50">
          {!sidebarCollapsed && (
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              zoehis-helper
            </h1>
          )}
          <button 
            onClick={toggleSidebar} 
            className="p-1.5 hover:bg-slate-200 rounded-full transition-all duration-200 text-slate-500 hover:text-slate-700 hover:shadow-md"
            title={sidebarCollapsed ? '展开导航栏' : '收起导航栏'}
          >
            {sidebarCollapsed ? (
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
        
        {/* 导航菜单 */}
        <nav className="flex-1 p-3 space-y-1.5">
          <button
            onClick={() => setShowDatasources(false)}
            className={`w-full flex items-center justify-center ${!sidebarCollapsed ? 'space-x-3 px-3' : ''} py-2.5 rounded-xl transition-all duration-200 ${
              !showDatasources 
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200' 
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="text-xl">📊</span>
            {!sidebarCollapsed && <span className="font-medium text-sm">数据查询</span>}
          </button>
          
          <button
            onClick={() => setShowDatasources(true)}
            className={`w-full flex items-center justify-center ${!sidebarCollapsed ? 'space-x-3 px-3' : ''} py-2.5 rounded-xl transition-all duration-200 ${
              showDatasources 
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200' 
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="text-xl">🔌</span>
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
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredTables.length} / {schema.length}</span>
                  </div>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="搜索表名或注释..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
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
                    <div className="p-6 text-center text-slate-400">
                      <div className="animate-pulse">
                        <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        加载中...
                      </div>
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
                      {filteredTables.map((table) => {
                        const isOpen = openTabs.some(tab => tab.tableName === table.tableName);
                        return (
                          <div
                            key={table.tableName}
                            onClick={() => openTable(table)}
                            className={`px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 group ${
                              isOpen 
                                ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 shadow-sm' 
                                : 'hover:bg-slate-100 border border-transparent hover:border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`font-mono text-xs font-medium ${isOpen ? 'text-blue-700' : 'text-slate-700'}`}>
                                {table.tableName}
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
                  {openTabs.map((tab) => (
                    <div
                      key={tab.tableName}
                      className={`flex items-center px-4 py-3 cursor-pointer min-w-max transition-all duration-200 group border-r border-slate-100 last:border-r-0 ${
                        activeTabKey === tab.tableName 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border-b-2 border-blue-500' 
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                      }`}
                      onClick={() => setActiveTabKey(tab.tableName)}
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
                          onClick={() => setActiveSubTab('query')}
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
                            const isUsed = usedFieldsSet.has(col.columnName);

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
                  <div className="flex-1 overflow-auto space-y-4">
                    <div className="mb-4 p-3 bg-white rounded-lg flex items-center space-x-4">
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

                    <div className="bg-white p-4 rounded-lg shadow">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">查询条件</h4>
                        <div className="space-x-2">
                          {getUsedColumns(activeTable.tableInfo).length > 0 && (
                            <select
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                              onChange={(e) => {
                                if (e.target.value) {
                                  addQueryCondition(activeTable.tableName, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">添加条件</option>
                              {getUsedColumns(activeTable.tableInfo).map(col => (
                                <option key={col.columnName} value={col.columnName}>
                                  {getColumnDisplayName(col)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      {(queryConditions[activeTable.tableName] || []).map((condition, index) => {
                        const column = activeTable.tableInfo.columns.find(c => c.columnName === condition.columnName);
                        return (
                          <div key={index} className="flex items-center space-x-2 mb-2">
                            <span className="font-mono text-sm w-32">{column ? getColumnDisplayName(column) : condition.columnName}</span>
                            <select
                              value={condition.operator}
                              onChange={(e) => updateQueryCondition(activeTable.tableName, index, 'operator', e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                            >
                              <option value="=">=</option>
                              <option value="!=">!=</option>
                              <option value=">">{'>'}</option>
                              <option value=">=">{'>='}</option>
                              <option value="<">{'>'}</option>
                              <option value="<=">{'>='}</option>
                              <option value="LIKE">LIKE</option>
                              <option value="IN">IN</option>
                              <option value="IS NULL">IS NULL</option>
                              <option value="IS NOT NULL">IS NOT NULL</option>
                            </select>
                            {condition.operator !== 'IS NULL' && condition.operator !== 'IS NOT NULL' && (
                              <input
                                type="text"
                                value={condition.value}
                                onChange={(e) => updateQueryCondition(activeTable.tableName, index, 'value', e.target.value)}
                                placeholder="值"
                                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                              />
                            )}
                            <button onClick={() => removeQueryCondition(activeTable.tableName, index)} className="text-red-500 hover:text-red-700">移除</button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-white p-4 rounded-lg shadow">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">排序条件</h4>
                        <div className="space-x-2">
                          {getUsedColumns(activeTable.tableInfo).length > 0 && (
                            <select
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                              onChange={(e) => {
                                if (e.target.value) {
                                  addSortCondition(activeTable.tableName, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">添加排序</option>
                              {getUsedColumns(activeTable.tableInfo).map(col => (
                                <option key={col.columnName} value={col.columnName}>
                                  {getColumnDisplayName(col)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      {(sortConditions[activeTable.tableName] || []).map((sort, index) => {
                        const column = activeTable.tableInfo.columns.find(c => c.columnName === sort.columnName);
                        return (
                          <div key={index} className="flex items-center space-x-2 mb-2">
                            <span className="font-mono text-sm w-32">{column ? getColumnDisplayName(column) : sort.columnName}</span>
                            <select
                              value={sort.order}
                              onChange={(e) => updateSortCondition(activeTable.tableName, index, 'order', e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                            >
                              <option value="ASC">ASC</option>
                              <option value="DESC">DESC</option>
                            </select>
                            <button onClick={() => removeSortCondition(activeTable.tableName, index)} className="text-red-500 hover:text-red-700">移除</button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => executeQuery(activeTable.tableInfo, activeTable.tableName)}
                        disabled={isExecuting}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                      >
                        {isExecuting ? '执行中...' : '执行查询'}
                      </button>
                      <button onClick={() => exportSQL(activeTable.tableInfo, activeTable.tableName)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">导出 SQL</button>
                      <button onClick={() => exportExcel(activeTable.tableInfo, activeTable.tableName)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">导出 Excel</button>
                    </div>

                    {queryResults[activeTable.tableName] && (
                      <div className="mt-4 bg-white rounded-lg shadow">
                        <h4 className="font-semibold mb-2 p-4">查询结果 ({queryResults[activeTable.tableName].rows.length} 条)</h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                {queryResults[activeTable.tableName].columns.map((col) => (
                                  <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-600 border">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {queryResults[activeTable.tableName].rows.slice(0, 100).map((row, index) => (
                                <tr key={index} className="hover:bg-gray-50">
                                  {row.map((cell, i) => (
                                    <td key={i} className="px-3 py-2 text-sm border">
                                      {cell !== null && cell !== undefined ? String(cell) : '-'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {queryResults[activeTable.tableName].rows.length > 100 && (
                          <p className="text-sm text-gray-500 p-4">显示前100条结果，完整结果请导出Excel</p>
                        )}
                      </div>
                    )}
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
    </div>
  );
}

export default Schema;
