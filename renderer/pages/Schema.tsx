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

function Schema() {
  const [showDatasources, setShowDatasources] = useState(false);
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'columns' | 'indexes' | 'query'>('columns');
  const [searchTerm, setSearchTerm] = useState('');
  const [queryConditions, setQueryConditions] = useState<QueryCondition[]>([]);
  const [sortConditions, setSortConditions] = useState<SortCondition[]>([]);
  const [queryResults, setQueryResults] = useState<{ columns: string[]; rows: any[][] } | null>(null);
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
    setSelectedTable(null);
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

  const addQueryCondition = (columnName: string) => {
    setQueryConditions([...queryConditions, { columnName, operator: '=', value: '' }]);
  };

  const removeQueryCondition = (index: number) => {
    setQueryConditions(queryConditions.filter((_, i) => i !== index));
  };

  const updateQueryCondition = (index: number, field: keyof QueryCondition, value: string) => {
    const newConditions = [...queryConditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setQueryConditions(newConditions);
  };

  const addSortCondition = (columnName: string) => {
    setSortConditions([...sortConditions, { columnName, order: 'ASC' }]);
  };

  const removeSortCondition = (index: number) => {
    setSortConditions(sortConditions.filter((_, i) => i !== index));
  };

  const updateSortCondition = (index: number, field: keyof SortCondition, value: string) => {
    const newConditions = [...sortConditions];
    newConditions[index] = { ...newConditions[index], [field]: value as any };
    setSortConditions(newConditions);
  };

  const generateSQL = (table: TableInfo) => {
    const usedColumns = getUsedColumns(table);
    const selectColumns = usedColumns.length > 0 ? usedColumns.map(c => c.columnName).join(', ') : '*';
    let sql = `SELECT ${selectColumns} FROM ${table.tableName}`;
    
    if (queryConditions.length > 0) {
      const conditions = queryConditions.map(c => {
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
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    if (sortConditions.length > 0) {
      const sorts = sortConditions.map(s => `${s.columnName} ${s.order}`);
      sql += ` ORDER BY ${sorts.join(', ')}`;
    }
    
    return sql;
  };

  const exportSQL = (table: TableInfo) => {
    const sql = generateSQL(table);
    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.tableName}_query_${Date.now()}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = (table: TableInfo) => {
    if (!queryResults || queryResults.rows.length === 0) {
      alert('没有数据可以导出，请先执行查询');
      return;
    }
    
    const csvContent = [
      queryResults.columns.join(','),
      ...queryResults.rows.map(row => row.map(cell => {
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

  const executeQuery = async (table: TableInfo) => {
    if (!activeDataSource?.id) return;
    
    setIsExecuting(true);
    setQueryResults(null);
    
    try {
      const sql = generateSQL(table);
      const results = await window.electronAPI.executeQuery(activeDataSource.id, sql);
      setQueryResults(results);
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
    <div className="flex h-screen bg-gray-100">
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
        <div className="flex-1 overflow-auto p-6">
          <DataSources />
        </div>
      ) : (
        <div className="flex-1 flex h-full">
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
                  {filteredTables.map((table) => (
                    <div
                      key={table.tableName}
                      onClick={() => setSelectedTable(table)}
                      className={`px-4 py-3 cursor-pointer ${selectedTable?.tableName === table.tableName ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="font-mono text-sm">{table.tableName}</div>
                      {table.comments && (
                        <div className="text-xs text-gray-500">{table.comments}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 bg-gray-50 p-6 overflow-auto">
            {!selectedTable ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                点击左侧表格查看表详情
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold">{selectedTable.tableName}</h2>
                    {selectedTable.comments && (
                      <p className="text-gray-500">{selectedTable.comments}</p>
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
                    onClick={() => setActiveTab('columns')}
                    className={`pb-2 border-b-2 font-medium ${activeTab === 'columns' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    列信息 ({getTableColumns(selectedTable).length})
                  </button>
                  {selectedTable.indexes.length > 0 && (
                    <button
                      onClick={() => setActiveTab('indexes')}
                      className={`pb-2 border-b-2 font-medium ${activeTab === 'indexes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                      索引信息 ({selectedTable.indexes.length})
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('query')}
                    className={`pb-2 border-b-2 font-medium ${activeTab === 'query' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    数据查询
                  </button>
                </div>

                {activeTab === 'columns' && (
                  <>
                    <div className="mb-4 p-3 bg-white rounded-lg flex items-center space-x-4">
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
                            checked={getShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${selectedTable.tableName}`)}
                            onChange={(e) => setShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${selectedTable.tableName}`, e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm">仅显示已标记字段</span>
                        </label>
                      )}
                    </div>

                    <div className="overflow-x-auto bg-white rounded-lg shadow">
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
                          {getTableColumns(selectedTable).map((col) => {
                            const usedFieldsSet = activeDataSource?.id ? getUsedFields(activeDataSource.id, selectedTable.tableName) : new Set();
                            const isUsed = usedFieldsSet.has(col.columnName);

                            return (
                              <tr key={col.columnName} className={`hover:bg-gray-50 ${isUsed ? 'bg-green-50' : ''}`}>
                                <td className="px-3 py-2">
                                  {activeDataSource?.id && (
                                    <input
                                      type="checkbox"
                                      checked={isUsed}
                                      onChange={(e) => {
                                        toggleFieldUsed(activeDataSource.id, selectedTable.tableName, col.columnName, e.target.checked);
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
                  </>
                )}

                {activeTab === 'indexes' && selectedTable.indexes.length > 0 && (
                  <div className="bg-white rounded-lg shadow overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">索引名</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">列名</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">类型</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">唯一性</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedTable.indexes.map((idx) => (
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

                {activeTab === 'query' && (
                  <div className="space-y-4">
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
                          {getUsedColumns(selectedTable).length > 0 && (
                            <select
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                              onChange={(e) => {
                                if (e.target.value) {
                                  addQueryCondition(e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">添加条件</option>
                              {getUsedColumns(selectedTable).map(col => (
                                <option key={col.columnName} value={col.columnName}>
                                  {getColumnDisplayName(col)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      {queryConditions.map((condition, index) => {
                        const column = selectedTable.columns.find(c => c.columnName === condition.columnName);
                        return (
                          <div key={index} className="flex items-center space-x-2 mb-2">
                            <span className="font-mono text-sm w-32">{column ? getColumnDisplayName(column) : condition.columnName}</span>
                            <select
                              value={condition.operator}
                              onChange={(e) => updateQueryCondition(index, 'operator', e.target.value)}
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
                                onChange={(e) => updateQueryCondition(index, 'value', e.target.value)}
                                placeholder="值"
                                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                              />
                            )}
                            <button onClick={() => removeQueryCondition(index)} className="text-red-500 hover:text-red-700">移除</button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-white p-4 rounded-lg shadow">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">排序条件</h4>
                        <div className="space-x-2">
                          {getUsedColumns(selectedTable).length > 0 && (
                            <select
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                              onChange={(e) => {
                                if (e.target.value) {
                                  addSortCondition(e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">添加排序</option>
                              {getUsedColumns(selectedTable).map(col => (
                                <option key={col.columnName} value={col.columnName}>
                                  {getColumnDisplayName(col)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      {sortConditions.map((sort, index) => {
                        const column = selectedTable.columns.find(c => c.columnName === sort.columnName);
                        return (
                          <div key={index} className="flex items-center space-x-2 mb-2">
                            <span className="font-mono text-sm w-32">{column ? getColumnDisplayName(column) : sort.columnName}</span>
                            <select
                              value={sort.order}
                              onChange={(e) => updateSortCondition(index, 'order', e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                            >
                              <option value="ASC">ASC</option>
                              <option value="DESC">DESC</option>
                            </select>
                            <button onClick={() => removeSortCondition(index)} className="text-red-500 hover:text-red-700">移除</button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => executeQuery(selectedTable)}
                        disabled={isExecuting}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                      >
                        {isExecuting ? '执行中...' : '执行查询'}
                      </button>
                      <button onClick={() => exportSQL(selectedTable)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">导出 SQL</button>
                      <button onClick={() => exportExcel(selectedTable)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">导出 Excel</button>
                    </div>

                    {queryResults && (
                      <div className="mt-4 bg-white rounded-lg shadow">
                        <h4 className="font-semibold mb-2 p-4">查询结果 ({queryResults.rows.length} 条)</h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                {queryResults.columns.map((col) => (
                                  <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-600 border">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {queryResults.rows.slice(0, 100).map((row, index) => (
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
                        {queryResults.rows.length > 100 && (
                          <p className="text-sm text-gray-500 p-4">显示前100条结果，完整结果请导出Excel</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Schema;
