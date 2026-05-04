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
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">zoehis-helper</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setShowDatasources(false)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${!showDatasources ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            <span className="text-lg">📊</span>
            <span className="font-medium">数据查询</span>
          </button>
          
          <button
            onClick={() => setShowDatasources(true)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${showDatasources ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            <span className="text-lg">🔌</span>
            <span className="font-medium">数据源管理</span>
          </button>
        </nav>
      </div>

      {showDatasources ? (
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          <DataSources />
        </div>
      ) : (
        <div className="flex-1 flex">
          <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">表列表</span>
                <span className="text-sm text-gray-400">{filteredTables.length} / {schema.length}</span>
              </div>
              <input
                type="text"
                placeholder="搜索表名或注释..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {schemaLoading ? (
                <div className="p-4 text-center text-gray-500">加载中...</div>
              ) : schemaError ? (
                <div className="p-4 text-center text-red-500">{schemaError}</div>
              ) : filteredTables.length === 0 ? (
                <div className="p-4 text-center text-gray-500">没有匹配的表</div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredTables.map((table) => {
                    const isOpen = openTabs.some(tab => tab.tableName === table.tableName);
                    return (
                      <div
                        key={table.tableName}
                        onClick={() => openTable(table)}
                        className={`px-4 py-3 cursor-pointer ${isOpen ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-gray-50'}`}
                      >
                        <div className="font-mono text-sm">{table.tableName}</div>
                        {table.comments && (
                          <div className="text-xs text-gray-500">{table.comments}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 bg-gray-50 flex flex-col overflow-hidden">
            {openTabs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                点击左侧表格打开表详情
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 标签页栏 */}
                <div className="bg-white border-b border-gray-200 flex items-center overflow-x-auto">
                  {openTabs.map((tab) => (
                    <div
                      key={tab.tableName}
                      className={`flex items-center px-4 py-2 border-r border-gray-200 cursor-pointer min-w-max ${activeTabKey === tab.tableName ? 'bg-blue-50 border-b-2 border-blue-500' : 'hover:bg-gray-50'}`}
                      onClick={() => setActiveTabKey(tab.tableName)}
                    >
                      <span className="text-sm font-medium mr-2">{tab.tableInfo.comments || tab.tableName}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.tableName);
                        }}
                        className="text-gray-400 hover:text-gray-600 text-sm"
                      >
                        ×
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
                          <h2 className="text-xl font-bold">{activeTable.tableInfo.tableName}</h2>
                          {activeTable.tableInfo.comments && (
                            <p className="text-gray-500">{activeTable.tableInfo.comments}</p>
                          )}
                        </div>
                        <select
                          value={activeDataSource?.id || ''}
                          onChange={(e) => handleDataSourceChange(e.target.value)}
                          className="border border-gray-300 rounded-lg px-4 py-2"
                        >
                          <option value="">选择数据源</option>
                          {dataSources.map((ds) => (
                            <option key={ds.id} value={ds.id}>
                              {ds.name} ({ds.type})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex space-x-4 border-b border-gray-200 pb-4 mb-4">
                        <button
                          onClick={() => setActiveSubTab('columns')}
                          className={`pb-2 border-b-2 font-medium ${activeSubTab === 'columns' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                          列信息 ({getTableColumns(activeTable.tableInfo).length})
                        </button>
                        {activeTable.tableInfo.indexes.length > 0 && (
                          <button
                            onClick={() => setActiveSubTab('indexes')}
                            className={`pb-2 border-b-2 font-medium ${activeSubTab === 'indexes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                          >
                            索引信息 ({activeTable.tableInfo.indexes.length})
                          </button>
                        )}
                        <button
                          onClick={() => setActiveSubTab('query')}
                          className={`pb-2 border-b-2 font-medium ${activeSubTab === 'query' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                          数据查询
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
