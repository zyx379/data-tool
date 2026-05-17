import { useState, useEffect, useRef } from 'react';
import DataSources from './DataSources';
import ReportPage from './Report';
import { useDataSourceStore, TableInfo, TableColumn, SavedConditionJoin } from '../stores/dataSourceStore';
import { useAnalysisStore } from '../stores/analysisStore';
import { useProjectStore } from '../stores/projectStore';

interface TablesByOwner {
  [owner: string]: TableInfo[];
}

interface QueryCondition {
  columnName: string;
  operator: string;
  value: string;
}

/** 单行条件 + 稳定 id；与上一行的逻辑关系（首行无） */
interface QueryConditionRow extends QueryCondition {
  id: string;
  joinWithPrevious?: SavedConditionJoin;
}

interface SortCondition {
  id: string;
  columnName: string;
  order: 'ASC' | 'DESC';
}

interface OpenTab {
  tableName: string;
  tableInfo: TableInfo;
}

const isDateTimeType = (dataType: string): boolean => {
  const lowerType = dataType.toLowerCase();
  return lowerType.includes('date') || lowerType.includes('timestamp') || lowerType.includes('time');
};

const formatDateTime = (value: any): string => {
  if (value === null || value === undefined) return '-';
  
  let dateValue: Date;
  
  if (value instanceof Date) {
    dateValue = value;
  } else if (typeof value === 'string') {
    dateValue = new Date(value);
  } else {
    return String(value);
  }
  
  if (isNaN(dateValue.getTime())) {
    return String(value);
  }
  
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  const hours = String(dateValue.getHours()).padStart(2, '0');
  const minutes = String(dateValue.getMinutes()).padStart(2, '0');
  const seconds = String(dateValue.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

function newQueryConditionRow(columnName: string, joinWithPrevious?: SavedConditionJoin): QueryConditionRow {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    columnName,
    operator: '=',
    value: '',
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
  };
}

function sqlFragmentForCondition(c: QueryCondition): string {
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
}

/** 自上而下左结合：((c0 op c1) op c2)…，与界面顺序一致 */
function whereSqlFromRows(rows: QueryConditionRow[]): string {
  if (rows.length === 0) return '';
  const sanitized = rows.map((row, i) =>
    i === 0 ? { ...row, joinWithPrevious: undefined } : { ...row, joinWithPrevious: row.joinWithPrevious ?? 'AND' }
  );
  let expr = sqlFragmentForCondition(sanitized[0]);
  for (let i = 1; i < sanitized.length; i++) {
    const join = sanitized[i].joinWithPrevious as SavedConditionJoin;
    expr = `(${expr} ${join} ${sqlFragmentForCondition(sanitized[i])})`;
  }
  return expr;
}

function Schema() {
  // 主导航标签: 'query' | 'datasources' | 'analysis' | 'report'
  const [activeMainTab, setActiveMainTab] = useState<'query' | 'datasources' | 'analysis' | 'report'>('query');
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'columns' | 'indexes' | 'query'>('columns');
  const [searchTerm, setSearchTerm] = useState('');
  const [queryConditions, setQueryConditions] = useState<Record<string, QueryConditionRow[]>>({});
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
  const [queryDropdownOpen, setQueryDropdownOpen] = useState<Record<string, boolean>>({});
  const [sortDropdownOpen, setSortDropdownOpen] = useState<Record<string, boolean>>({});
  const valueInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const queryScrollRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
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
    const joins: SavedConditionJoin[] = conditions.slice(1).map((r) => r.joinWithPrevious ?? 'AND');

    saveQueryConditionTemplate(savedConditionName.trim(), activeTabKey, columns, operators, joins);
    setSavedConditionName('');
    setShowSaveConditionModal(false);
  };

  const loadQueryConditionTemplate = (template: any) => {
    if (!activeTabKey) return;
    
    const joins = template.joins;
    const newConditions: QueryConditionRow[] = template.columns.map((col: string, idx: number) =>
      newQueryConditionRow(col, idx === 0 ? undefined : joins?.[idx - 1] ?? 'AND')
    ).map((row, idx) => ({
      ...row,
      operator: template.operators[idx] || '=',
    }));
    
    setQueryConditions({
      ...queryConditions,
      [activeTabKey]: newConditions
    });
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
    activeDataSource,
    loadActiveProjectDetails,
    executeQuery: executeProjectQuery,
  } = useProjectStore();

  const {
    schema,
    schemaLoading,
    schemaError,
    loadSchemaFromCache,
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
    filterNoCommentTables,
    setFilterNoCommentTables,
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
    loadActiveProjectDetails();
  }, [loadActiveProjectDetails]);

  // 数据源变更时，从缓存加载 schema
  useEffect(() => {
    console.log('[DEBUG] Schema component useEffect triggered with activeDataSource:', activeDataSource);
    if (activeDataSource?.id) {
      console.log('[DEBUG] Active data source found, id:', activeDataSource.id);
      // 先设置 dataSourceStore 的 activeDataSource 供内部方法使用
      const dsCompat = {
        id: activeDataSource.id,
        name: activeDataSource.name,
        type: activeDataSource.type,
        host: activeDataSource.host,
        port: activeDataSource.port,
        sid: activeDataSource.sid,
        serviceName: activeDataSource.serviceName,
        schema: activeDataSource.schema,
        username: activeDataSource.username,
        password: activeDataSource.password,
        isActive: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useDataSourceStore.setState({ activeDataSource: dsCompat });
      
      // 从缓存加载表结构
      console.log('[DEBUG] Calling loadSchemaFromCache with id:', activeDataSource.id);
      loadSchemaFromCache(activeDataSource.id);
    } else {
      console.log('[DEBUG] No active data source, clearing schema');
      useDataSourceStore.setState({ 
        activeDataSource: null, 
        schema: [] 
      });
    }
  }, [activeDataSource?.id, loadSchemaFromCache]);

  useEffect(() => {
    setHasAutoAddedDefaultFields(false);
  }, [activeTabKey]);

  useEffect(() => {
    if (activeSubTab !== 'query') {
      setShowBackToTop(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Home' && queryScrollRef.current) {
        e.preventDefault();
        queryScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSubTab]);

  const filteredTables = schema.filter((table) => {
    if (!searchTerm) return true;
    return (
      table.tableName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      table.comments.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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
    const join: SavedConditionJoin | undefined = currentConditions.length === 0 ? undefined : 'AND';
    const row = newQueryConditionRow(columnName, join);
    const newIndex = currentConditions.length;
    setQueryConditions({
      ...queryConditions,
      [tableName]: [...currentConditions, row]
    });
    // 关闭查询条件下拉
    setQueryDropdownOpen(prev => ({ ...prev, [tableName]: false }));
    // 延迟聚焦到值输入框
    setTimeout(() => {
      const key = `${tableName}-${row.id}`;
      if (valueInputRef.current && valueInputRef.current[key]) {
        valueInputRef.current[key]?.focus();
      }
    }, 50);
  };

  const removeQueryCondition = (tableName: string, index: number) => {
    const currentConditions = queryConditions[tableName] || [];
    const next = currentConditions
      .filter((_, i) => i !== index)
      .map((r, i) => (i === 0 ? { ...r, joinWithPrevious: undefined as undefined } : r));
    setQueryConditions({
      ...queryConditions,
      [tableName]: next
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

  const updateConditionJoin = (tableName: string, index: number, join: SavedConditionJoin) => {
    if (index <= 0) return;
    const currentConditions = queryConditions[tableName] || [];
    const newConditions = [...currentConditions];
    newConditions[index] = { ...newConditions[index], joinWithPrevious: join };
    setQueryConditions({
      ...queryConditions,
      [tableName]: newConditions
    });
  };

  const addSortCondition = (tableName: string, columnName: string) => {
    const currentConditions = sortConditions[tableName] || [];
    setSortConditions({
      ...sortConditions,
      [tableName]: [
        ...currentConditions,
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, columnName, order: 'DESC' },
      ],
    });
    // 关闭排序条件下拉
    setSortDropdownOpen(prev => ({ ...prev, [tableName]: false }));
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const reorderSortConditions = (tableName: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const list = [...(sortConditions[tableName] || [])];
    const [removed] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, removed);
    setSortConditions({ ...sortConditions, [tableName]: list });
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

  const toggleSortOrder = (tableName: string, index: number) => {
    const currentConditions = sortConditions[tableName] || [];
    const row = currentConditions[index];
    if (!row) return;
    const nextOrder = row.order === 'ASC' ? 'DESC' : 'ASC';
    updateSortCondition(tableName, index, 'order', nextOrder);
  };

  const MAX_QUERY_LIMIT = 1000;

  const buildSQL = (table: TableInfo, tableName: string) => {
    const showOnlyUsed = activeDataSource?.id ? getShowOnlyUsedFieldsByTable(`${activeDataSource.id}_${tableName}`) : false;
    const usedColumns = getUsedColumns(table);
    
    let selectColumns: string;
    if (showOnlyUsed) {
      selectColumns = usedColumns.length > 0 ? usedColumns.map(c => c.columnName).join(', ') : '*';
    } else {
      selectColumns = '*';
    }
    
    let sql = `SELECT ${selectColumns} FROM ${table.tableName}`;
    
    const rows = queryConditions[tableName] || [];
    if (rows.length > 0) {
      sql += ` WHERE ${whereSqlFromRows(rows)}`;
    }
    
    const sorts = sortConditions[tableName] || [];
    if (sorts.length > 0) {
      const orderClauses = sorts.map(s => `${s.columnName} ${s.order}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    
    return sql;
  };

  const generateSQL = (table: TableInfo, tableName: string) => {
    let sql = buildSQL(table, tableName);
    
    if (activeDataSource?.type === 'oracle') {
      sql = `SELECT * FROM (${sql}) WHERE ROWNUM <= ${MAX_QUERY_LIMIT}`;
    } else if (activeDataSource?.type === 'dameng') {
      sql = `SELECT TOP ${MAX_QUERY_LIMIT} * FROM (${sql})`;
    } else {
      sql += ` LIMIT ${MAX_QUERY_LIMIT}`;
    }
    
    return sql;
  };

  const exportSQL = (table: TableInfo, tableName: string) => {
    const sql = buildSQL(table, tableName);
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
      const results = await executeProjectQuery(sql);
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
    <div className="flex flex-col flex-1 h-full">
      {/* 顶部导航栏 */}
      <div className="h-12 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center px-4 shadow-sm z-[60] relative">
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setActiveMainTab('query')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeMainTab === 'query'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>📊</span>
            <span>数据查询</span>
          </button>
          <button
            onClick={() => setActiveMainTab('analysis')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeMainTab === 'analysis'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>🤖</span>
            <span>智能分析</span>
          </button>
          <button
            onClick={() => setActiveMainTab('report')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeMainTab === 'report'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>📈</span>
            <span>AI报表</span>
          </button>
          <button
            onClick={() => setActiveMainTab('datasources')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeMainTab === 'datasources'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>🔌</span>
            <span>项目管理</span>
          </button>
        </nav>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {activeMainTab === 'datasources' ? (
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          <DataSources />
        </div>
      ) : activeMainTab === 'analysis' ? (
        <AnalysisPage />
      ) : activeMainTab === 'report' ? (
        <ReportPage />
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
                        <p className="text-sm font-medium">
                          {schemaProgress?.phase === 'loading' ? '正在获取表列表…' : '正在加载表结构…'}
                        </p>
                        {schemaProgress?.detail && (
                          <p className="mt-1 text-xs text-slate-400 px-1 leading-snug">{schemaProgress.detail}</p>
                        )}
                      </div>
                      {schemaProgress && schemaProgress.total > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-xs text-slate-400 mb-1 gap-2">
                            <span className="truncate min-w-0 font-mono" title={schemaProgress.currentTable}>
                              {schemaProgress.currentTable}
                            </span>
                            <span className="flex-shrink-0">{schemaProgress.current} / {schemaProgress.total}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-[width] duration-500 ease-out"
                              style={{ width: `${Math.min(100, (schemaProgress.current / schemaProgress.total) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {schemaProgress && schemaProgress.total === 0 && schemaProgress.phase === 'loading' && (
                        <div className="mb-2 h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-400 to-indigo-400 animate-pulse" />
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
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-6">
                      <div className="mb-6">
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
                              setHasAutoAddedDefaultFields(true);
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
                                        if (activeDataSource?.id) {
                                          toggleFieldUsed(activeDataSource.id, activeTable.tableName, col.columnName, e.target.checked);
                                        }
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
                        {activeTable.tableInfo.indexes.map((idx, index) => (
                          <tr key={`${idx.indexName}-${idx.columnName}-${index}`} className="hover:bg-gray-50">
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
                  <div
                    className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
                    ref={queryScrollRef}
                    onScroll={(e) => setShowBackToTop(e.currentTarget.scrollTop > 200)}
                  >
                    <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center space-x-2 cursor-pointer whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={showColumnNamesInChinese}
                              onChange={(e) => setShowColumnNamesInChinese(e.target.checked)}
                              className="rounded"
                            />
                            <span className="text-sm">列名显示中文</span>
                          </label>

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
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => executeQuery(activeTable.tableInfo, activeTable.tableName)}
                          disabled={isExecuting}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium text-sm shadow-sm"
                        >
                          {isExecuting ? '执行中...' : '执行查询'}
                        </button>
                        <button onClick={() => exportSQL(activeTable.tableInfo, activeTable.tableName)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors shadow-sm">导出 SQL</button>
                        <button onClick={() => exportExcel(activeTable.tableInfo, activeTable.tableName)} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm transition-colors shadow-sm">导出 Excel</button>
                      </div>
                    </div>

                    <div className="flex w-full min-w-0 max-w-full shrink-0 flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:gap-4">
                        <div className="flex w-full min-w-0 max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50/95 shadow-sm md:w-[63%] md:max-w-[63%] md:flex-none">
                          <div className="flex flex-shrink-0 flex-col gap-2 border-b border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <span className="text-xs font-semibold text-slate-700">查询条件</span>
                              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                                自上而下组合；AND / OR 表示与「上一条完整条件」的关系，生成 WHERE 时按该顺序加括号。
                              </p>
                            </div>
                            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                              {(queryConditions[activeTable.tableName] || []).length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowSaveConditionModal(true)}
                                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                                >
                                  保存为模板
                                </button>
                              )}
                              {getUsedColumns(activeTable.tableInfo).length > 0 && (
                                <div className="relative">
                                  <input
                                    type="text"
                                    placeholder="+ 添加字段"
                                    className="w-36 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    onFocus={() => setQueryDropdownOpen((prev) => ({ ...prev, [activeTable.tableName]: true }))}
                                    onBlur={() => {
                                      setTimeout(() => {
                                        setQueryDropdownOpen((prev) => ({ ...prev, [activeTable.tableName]: false }));
                                        const inputEl = document.querySelector(
                                          `[data-table="${activeTable.tableName}"][role="query-input"]`
                                        ) as HTMLInputElement;
                                        if (inputEl) inputEl.value = '';
                                      }, 200);
                                    }}
                                    onKeyDown={(e) => {
                                      if ((e as React.KeyboardEvent<HTMLInputElement>).key === 'Enter') {
                                        const inputEl = e.currentTarget;
                                        const val = inputEl.value.trim();
                                        if (val) {
                                          const validColumns = getUsedColumns(activeTable.tableInfo).map((c) => c.columnName);
                                          const match = validColumns.find((c) => c.toLowerCase() === val.toLowerCase());
                                          if (match) {
                                            addQueryCondition(activeTable.tableName, match);
                                            inputEl.value = '';
                                          }
                                        }
                                      }
                                    }}
                                    data-table={activeTable.tableName}
                                    role="query-input"
                                  />
                                  {queryDropdownOpen[activeTable.tableName] && (
                                    <div className="absolute left-0 top-full z-50 mt-1 max-h-48 min-w-[10rem] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                      {getUsedColumns(activeTable.tableInfo)
                                        .filter((col) => {
                                          const inputEl = document.activeElement as HTMLInputElement;
                                          const filterText = inputEl?.value?.toLowerCase() || '';
                                          return (
                                            !filterText ||
                                            col.columnName.toLowerCase().includes(filterText) ||
                                            getColumnDisplayName(col).toLowerCase().includes(filterText)
                                          );
                                        })
                                        .map((col) => (
                                          <div
                                            key={col.columnName}
                                            className="cursor-pointer px-3 py-1.5 text-xs hover:bg-blue-50"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              addQueryCondition(activeTable.tableName, col.columnName);
                                            }}
                                          >
                                            <span className="font-mono">{col.columnName}</span>
                                            <span className="ml-1 text-slate-400">{getColumnDisplayName(col)}</span>
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="max-h-[min(24rem,50vh)] overflow-x-auto overflow-y-auto px-3 py-3">
                            {(queryConditions[activeTable.tableName] || []).length === 0 ? (
                              <p className="py-8 text-center text-xs text-slate-400">暂无条件，使用上方「添加字段」从已标记列中选择</p>
                            ) : (
                              (queryConditions[activeTable.tableName] || []).map((condition, index) => {
                                const column = activeTable.tableInfo.columns.find((c) => c.columnName === condition.columnName);
                                const join = condition.joinWithPrevious ?? 'AND';
                                return (
                                  <div key={condition.id} className={index > 0 ? 'mt-1' : ''}>
                                    {index > 0 && (
                                      <div className="flex justify-center py-2">
                                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                                          <button
                                            type="button"
                                            onClick={() => updateConditionJoin(activeTable.tableName, index, 'AND')}
                                            className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                                              join === 'AND'
                                                ? 'bg-slate-800 text-white'
                                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                            }`}
                                          >
                                            AND
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => updateConditionJoin(activeTable.tableName, index, 'OR')}
                                            className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                                              join === 'OR'
                                                ? 'bg-amber-600 text-white'
                                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                            }`}
                                          >
                                            OR
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 shadow-sm">
                                      <span
                                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold text-slate-600"
                                        title={`条件 ${index + 1}`}
                                      >
                                        {index + 1}
                                      </span>
                                      <div className="min-w-0 max-w-[12rem] flex-shrink-0">
                                        <div className="truncate font-mono text-[11px] text-slate-900" title={condition.columnName}>
                                          {condition.columnName}
                                        </div>
                                        {showColumnNamesInChinese && column?.comments ? (
                                          <div className="truncate text-[10px] text-slate-400" title={column.comments}>
                                            {column.comments}
                                          </div>
                                        ) : null}
                                      </div>
                                      <select
                                        value={condition.operator}
                                        onChange={(e) =>
                                          updateQueryCondition(activeTable.tableName, index, 'operator', e.target.value)
                                        }
                                        className="rounded border border-slate-200 bg-white py-1 pl-1 pr-6 text-xs text-slate-800"
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
                                          ref={(el) => {
                                            const key = `${activeTable.tableName}-${condition.id}`;
                                            valueInputRef.current[key] = el;
                                          }}
                                          type="text"
                                          value={condition.value}
                                          onChange={(e) =>
                                            updateQueryCondition(activeTable.tableName, index, 'value', e.target.value)
                                          }
                                          placeholder="值"
                                          className="min-w-[6rem] flex-1 rounded border border-transparent bg-slate-50 px-2 py-1 text-xs focus:border-blue-400 focus:bg-white focus:outline-none"
                                        />
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => removeQueryCondition(activeTable.tableName, index)}
                                        className="ml-auto flex-shrink-0 text-red-500 hover:text-red-700"
                                        title="移除此条件"
                                      >
                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="hidden w-px shrink-0 self-stretch bg-slate-200 md:block" aria-hidden />

                        <div className="flex w-full min-w-0 max-w-full flex-col rounded-xl border border-slate-200 bg-slate-50/95 shadow-sm md:w-[37%] md:max-w-[37%] md:flex-none">
                          <div className="flex-shrink-0 border-b border-slate-200 px-3 py-2">
                            <span className="text-xs font-semibold text-slate-700">排序条件</span>
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                              拖拽 ⋮⋮ 调整顺序；点击箭头切换升序 / 降序。
                            </p>
                          </div>
                          <div className="max-h-[min(24rem,50vh)] overflow-x-auto overflow-y-auto px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {(sortConditions[activeTable.tableName] || []).map((sort, index) => {
                                const column = activeTable.tableInfo.columns.find(c => c.columnName === sort.columnName);
                                const sortKey = sort.id || `sort-${sort.columnName}-${index}`;
                                return (
                                  <div
                                    key={sortKey}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('application/x-sort-index', String(index));
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = 'move';
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const from = parseInt(e.dataTransfer.getData('application/x-sort-index'), 10);
                                      if (!Number.isNaN(from)) {
                                        reorderSortConditions(activeTable.tableName, from, index);
                                      }
                                    }}
                                    className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2 text-xs shadow-sm ring-slate-200/80 transition-shadow hover:shadow-md"
                                  >
                                    <span
                                      className="cursor-grab select-none px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                                      title="拖拽调整顺序"
                                      aria-hidden
                                    >
                                      ⋮⋮
                                    </span>
                                    <span className="max-w-[10rem] truncate font-mono text-[11px] text-slate-800" title={sort.columnName}>
                                      {column ? getColumnDisplayName(column) : sort.columnName}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => toggleSortOrder(activeTable.tableName, index)}
                                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                                      title={sort.order === 'ASC' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
                                    >
                                      <span className="text-sm leading-none">{sort.order === 'ASC' ? '↑' : '↓'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeSortCondition(activeTable.tableName, index)}
                                      className="ml-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
                                      title="删除"
                                    >
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                );
                              })}
                              {getUsedColumns(activeTable.tableInfo).length > 0 && (
                                <div className="relative">
                                  <input
                                    type="text"
                                    placeholder="+ 添加字段"
                                    className="border border-gray-300 rounded px-2 py-1 text-xs bg-white w-32"
                                    onFocus={(e) => setSortDropdownOpen(prev => ({ ...prev, [activeTable.tableName]: true }))}
                                    onBlur={() => {
              setTimeout(() => {
                setSortDropdownOpen(prev => ({ ...prev, [activeTable.tableName]: false }));
                const inputEl = document.querySelector(`[data-table="${activeTable.tableName}"][role="sort-input"]`) as HTMLInputElement;
                if (inputEl) inputEl.value = '';
              }, 200);
            }}
            onKeyDown={(e) => {
              if ((e as React.KeyboardEvent<HTMLInputElement>).key === 'Enter') {
                const inputEl = e.currentTarget;
                const val = inputEl.value.trim();
                if (val) {
                  const validColumns = getUsedColumns(activeTable.tableInfo).map(c => c.columnName);
                  const match = validColumns.find(c => c.toLowerCase() === val.toLowerCase());
                  if (match) {
                    addSortCondition(activeTable.tableName, match);
                    inputEl.value = '';
                  }
                }
              }
            }}
            data-table={activeTable.tableName}
            role="sort-input"
                                  />
                                  {sortDropdownOpen[activeTable.tableName] && (
                                    <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto min-w-40">
                                      {getUsedColumns(activeTable.tableInfo)
                                        .filter(col => {
                                          const inputEl = document.activeElement as HTMLInputElement;
                                          const filterText = inputEl?.value?.toLowerCase() || '';
                                          return !filterText || col.columnName.toLowerCase().includes(filterText) || getColumnDisplayName(col).toLowerCase().includes(filterText);
                                        })
                                        .map(col => (
                                          <div
                                            key={col.columnName}
                                            className="px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              addSortCondition(activeTable.tableName, col.columnName);
                                            }}
                                          >
                                            <span className="font-mono">{col.columnName}</span>
                                            <span className="text-gray-400 ml-1">{getColumnDisplayName(col)}</span>
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                    </div>

                    <div className="flex min-h-[20rem] w-full min-w-0 max-w-full flex-col border-t border-slate-200 bg-white">
                      {queryResults[activeTable.tableName] ? (
                        (() => {
                          const results = queryResults[activeTable.tableName];
                          if (!results) return null;
                          return (
                        <div className="flex flex-col">
                          <div className="p-3 border-b border-slate-200 bg-gray-50 flex-shrink-0">
                            <h4 className="font-semibold text-gray-700 text-sm">
                              查询结果 ({results.rows.length} 条)
                              <span className="text-xs text-gray-400 ml-2 font-normal">
                                ({results.columns.length} 列)
                              </span>
                            </h4>
                          </div>
                          <div className="w-full max-w-full overflow-x-auto">
                            <table className="w-max min-w-full border-collapse">
                              <thead className="bg-gray-100 sticky top-0 z-10">
                                <tr>
                                  {results.columns.map((col) => (
                                    <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap">
                                      {(activeTable.tableInfo.columns.find(c => c.columnName === col)?.comments && showColumnNamesInChinese) ? activeTable.tableInfo.columns.find(c => c.columnName === col)?.comments : col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {results.rows.slice(0, 100).map((row, index) => (
                                  <tr key={index} className="hover:bg-blue-50 transition-colors">
                                    {row.map((cell, i) => {
                                      const columnName = results.columns[i];
                                      const columnInfo = activeTable.tableInfo.columns.find(c => c.columnName === columnName);
                                      const isDateTimeCol = columnInfo ? isDateTimeType(columnInfo.dataType) : false;
                                      const displayValue = isDateTimeCol ? formatDateTime(cell) : (cell !== null && cell !== undefined ? String(cell) : '-');
                                      return (
                                        <td key={i} className="whitespace-nowrap px-3 py-2 text-xs border-b border-r border-gray-100 max-w-xs truncate" title={String(cell ?? '-')}>
                                          {displayValue}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {results.rows.length > 100 && (
                            <div className="p-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 text-center">
                              显示前100条结果，完整结果请导出Excel
                            </div>
                          )}
                        </div>
                          );
                        })()
                      ) : (
                        <div className="flex min-h-[20rem] items-center justify-center text-gray-400">
                          <div className="text-center">
                            <svg className="w-16 h-16 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            <p className="text-sm">点击"执行查询"查看数据</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {showBackToTop && (
                      <button
                        type="button"
                        aria-label="回到顶部"
                        onClick={() => queryScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-full bg-blue-500 px-3 py-2 text-xs font-medium text-white shadow-lg transition-all hover:bg-blue-600 hover:shadow-xl active:scale-95"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                        </svg>
                        回到顶部
                      </button>
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

      {showRefreshModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4 z-50 relative">
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
              <label className="flex items-center space-x-2 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={filterNoCommentTables}
                  onChange={(e) => setFilterNoCommentTables(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-600">过滤无表注释的表（临时表等）</span>
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
                disabled={schemaLoading || !activeDataSource?.id}
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
                disabled={schemaLoading || !activeDataSource?.id}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {schemaLoading ? '加载中...' : '增量更新'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveConditionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4 z-50 relative">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4 z-50 relative">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-xl w-96 max-w-full mx-4 z-50 relative">
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
                disabled={!activeDataSource?.id}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ==================== 智能分析模块（重构版） ====================

function AnalysisPage() {
  const {
    analysisRecords,
    currentRecordId,
    isAnalyzing,
    formDescription,
    formLogId,
    deepAnalysisStreamContent,
    setFormDescription,
    setFormLogId,
    clearForm,
    startAnalysis,
    updateStep,
    completeStep,
    errorStep,
    appendStreamChunk,
    clearStreamContent,
    finishAnalysis,
    setCurrentRecordId,
    deleteRecord,
    clearAllRecords,
  } = useAnalysisStore();

  const { activeProject } = useProjectStore();
  const [view, setView] = useState<'new' | 'history' | 'detail'>('new');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentRecord = analysisRecords.find(r => r.id === currentRecordId) || null;

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    if (window.electronAPI?.onAnalysisStepUpdate) {
      cleanups.push(window.electronAPI.onAnalysisStepUpdate((stepData) => {
        updateStep(stepData);
      }));
    }
    if (window.electronAPI?.onAnalysisStepComplete) {
      cleanups.push(window.electronAPI.onAnalysisStepComplete((stepData) => {
        completeStep(stepData);
      }));
    }
    if (window.electronAPI?.onAnalysisStepError) {
      cleanups.push(window.electronAPI.onAnalysisStepError((stepData) => {
        errorStep(stepData);
        if (stepData.id === 'match_repository' || stepData.id === 'fetch_version_and_code' || stepData.id === 'deep_analysis') {
          finishAnalysis(stepData.error);
        }
      }));
    }
    if (window.electronAPI?.onAnalysisStreamChunk) {
      cleanups.push(window.electronAPI.onAnalysisStreamChunk((content) => {
        appendStreamChunk(content);
      }));
    }

    if (window.electronAPI?.onChatStreamChunk) {
      cleanups.push(window.electronAPI.onChatStreamChunk((data) => {
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'ai') {
            return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
          }
          return [...prev, { role: 'ai', content: data.chunk }];
        });
      }));
    }

    return () => cleanups.forEach(fn => fn());
  }, [updateStep, completeStep, errorStep, appendStreamChunk, finishAnalysis]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleStartAnalysis = async () => {
    if (!formDescription.trim() || !formLogId.trim()) {
      alert('请填写问题描述和日志 ID');
      return;
    }
    if (!activeProject?.id) {
      alert('请先在项目管理中选择一个项目');
      return;
    }

    const recordId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    startAnalysis(recordId, formDescription, formLogId, activeProject.id, activeProject.name);
    setView('detail');
    clearStreamContent();

    try {
      const result = await (window.electronAPI as any).startAnalysis({
        description: formDescription,
        logId: formLogId,
        projectId: activeProject.id,
      });

      if (!result.success) {
        finishAnalysis(result.message || '分析失败');
      } else {
        finishAnalysis();
      }
    } catch (error) {
      finishAnalysis((error as Error).message || '分析过程发生未知错误');
    }
  };

  const sendChatMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading || !activeProject?.id) return;

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);

    try {
      const result = await (window.electronAPI as any).sendChatMessage(activeProject.id, msg);
      if (!result.success) {
        setChatMessages(prev => [...prev, { role: 'ai', content: `错误：${result.message}` }]);
      }
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'ai', content: `错误：${(e as Error).message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleViewRecord = (id: string) => {
    clearStreamContent();
    setCurrentRecordId(id);
    setChatMessages([]);
    setView('detail');
  };

  const handleDeleteRecord = (id: string) => {
    if (confirm('确定要删除这条分析记录吗？')) {
      deleteRecord(id);
      if (currentRecordId === id) {
        setView('history');
      }
    }
  };

  const getStepIcon = (id: string) => {
    const icons: Record<string, string> = {
      query_log: '🔍',
      identify_service: '🤔',
      match_repository: '📦',
      fetch_version_and_code: '📥',
      deep_analysis: '🧠',
      conclusion: '📋',
    };
    return icons[id] || '📌';
  };

  const getStepStatusBadge = (status: string) => {
    switch (status) {
      case 'loading':
        return <span className="inline-flex items-center gap-1 text-blue-600 text-xs"><svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>执行中</span>;
      case 'completed':
        return <span className="text-green-600 text-xs">✅ 完成</span>;
      case 'error':
        return <span className="text-red-600 text-xs">❌ 失败</span>;
      default:
        return <span className="text-gray-400 text-xs">⏳ 等待中</span>;
    }
  };

  const renderNewAnalysis = () => (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">新建分析</h2>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              问题描述 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="请描述遇到的问题..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              日志 ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formLogId}
              onChange={(e) => setFormLogId(e.target.value)}
              placeholder="例如：4028838a8e0d3f3f018e..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目（自动读取）</label>
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600">
              {activeProject ? activeProject.name : <span className="text-red-500">未选择项目</span>}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={clearForm} className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">清空</button>
            <button
              onClick={handleStartAnalysis}
              disabled={isAnalyzing}
              className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isAnalyzing ? (
                <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>分析中</>
              ) : '开始分析'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-800">分析历史</h2>
        {analysisRecords.length > 0 && (
          <button onClick={() => { if (confirm('确定清空全部？')) clearAllRecords(); }}
            className="text-sm text-red-600 hover:text-red-800">清空全部</button>
        )}
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">问题描述</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">项目</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {analysisRecords.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">暂无分析记录</td></tr>
            ) : (
              analysisRecords.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-800 truncate max-w-xs">{record.description}</div>
                    <div className="text-xs text-gray-500 mt-0.5">日志: {record.logId}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{record.projectName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(record.timestamp).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      record.status === 'completed' ? 'bg-green-100 text-green-800'
                        : record.status === 'analyzing' ? 'bg-blue-100 text-blue-800'
                          : 'bg-red-100 text-red-800'
                    }`}>
                      {record.status === 'completed' ? '已完成' : record.status === 'analyzing' ? '分析中' : '错误'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => handleViewRecord(record.id)} className="text-blue-600 hover:text-blue-800 text-sm">查看</button>
                    <button onClick={() => handleDeleteRecord(record.id)} className="text-red-600 hover:text-red-800 text-sm">删除</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderDetail = () => {
    if (!currentRecord) return (
      <div className="text-center text-gray-500 py-8">未找到分析记录</div>
    );

    const record = currentRecord;
    const sortedSteps = [...record.steps].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <button onClick={() => setView('history')} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm">
          ← 返回列表
        </button>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3 text-sm text-gray-600 mb-1">
            <span className="text-gray-400">问题描述：</span>
            <span className="text-gray-800">{record.description}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span className="text-gray-400">日志ID：</span>
            <span className="font-mono text-xs">{record.logId}</span>
          </div>
        </div>

        {sortedSteps.map((step) => (
          <div key={step.id} className={`bg-white rounded-lg shadow-sm border ${
            step.status === 'error' ? 'border-red-300 bg-red-50' : 'border-gray-200'
          }`}>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                {getStepIcon(step.id)} {step.title}
              </h3>
              {getStepStatusBadge(step.status)}
            </div>

            {(step.status === 'completed' || step.status === 'error') && (
              <div className="p-5">
                {step.status === 'error' && step.error && (
                  <div className="mb-3 p-3 bg-red-100 border border-red-200 rounded-md text-sm text-red-700">
                    <strong>错误：</strong>{step.error}
                  </div>
                )}
                {step.content && (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {step.content}
                  </div>
                )}
                {!step.content && !step.error && (
                  <p className="text-gray-400 text-sm">无输出内容</p>
                )}
              </div>
            )}

            {step.status === 'loading' && step.id === 'deep_analysis' && isAnalyzing && record.id === currentRecordId && (
              <div className="p-5">
                <div className="flex items-center gap-2 text-blue-600 text-sm mb-3">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  深度分析中，AI 正在逐步调用工具...
                </div>
                {deepAnalysisStreamContent && (
                  <div className="bg-gray-50 rounded-md p-4 max-h-[400px] overflow-y-auto">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                      {deepAnalysisStreamContent}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {step.status === 'loading' && step.id !== 'deep_analysis' && (
              <div className="p-5 flex items-center gap-2 text-blue-600 text-sm">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                执行中...
              </div>
            )}

            {step.status === 'pending' && (
              <div className="p-5 text-gray-400 text-sm">等待中...</div>
            )}
          </div>
        ))}

        {record.status === 'completed' && (
          <div className="bg-green-50 rounded-lg border border-green-200 p-4 text-center text-green-700 text-sm">
            ✅ 分析已完成
          </div>
        )}
        {record.status === 'error' && record.error && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-4 text-center text-red-700 text-sm">
            ❌ 分析失败：{record.error}
          </div>
        )}

        {record.status === 'completed' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">💬 追问对话</h3>
            </div>
            <div className="p-4 max-h-[400px] overflow-y-auto space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  在下方输入框补充描述或追问，AI 会结合上文分析结果回答
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-2 text-sm text-gray-400">
                    <svg className="animate-spin h-4 w-4 inline mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    思考中...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                placeholder="补充描述或继续提问..."
                disabled={chatLoading}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                发送
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <div className="mb-4 flex gap-2">
        <button onClick={() => { setView('new'); clearStreamContent(); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'new' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          }`}>+ 新建分析</button>
        <button onClick={() => setView('history')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'history' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          }`}>分析历史 {analysisRecords.length > 0 && `(${analysisRecords.length})`}</button>
      </div>
      {view === 'new' && renderNewAnalysis()}
      {view === 'history' && renderHistory()}
      {view === 'detail' && renderDetail()}
    </div>
  );
}



export default Schema;
