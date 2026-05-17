import { useEffect, useRef, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import { useReportStore, ReportMessage, ReportRecord } from '../stores/reportStore';
import { useProjectStore } from '../stores/projectStore';
import {
  extractSqlFromMarkdown,
  extractTitleFromMarkdown,
  extractReportAction,
  inferChartType,
  buildEChartsOption,
  groupHistoryByTime,
  exportCsv,
  exportExcel,
  copyToClipboard,
  ChartType,
} from '../utils/reportUtils';

function MarkdownContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="text-sm text-gray-800 space-y-1">
      {parts.map((part, i) => {
        const codeMatch = part.match(/```(\w*)\s*([\s\S]*?)```/);
        if (codeMatch) {
          const lang = codeMatch[1];
          const code = codeMatch[2].trim();
          if (lang === 'report-action') return null;
          return (
            <pre key={i} className="bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto text-xs my-2">
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <div
            key={i}
            className="whitespace-pre-wrap"
            dangerouslySetInnerHTML={{
              __html: part
                .replace(/^# (.+)$/gm, '<h3 class="font-semibold text-base mb-1">$1</h3>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
            }}
          />
        );
      })}
    </div>
  );
}

function EChartPanel({
  chartType,
  title,
  columns,
  rows,
}: {
  chartType: ChartType;
  title: string;
  columns: string[];
  rows: any[][];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || chartType === 'table') return;
    const option = buildEChartsOption(chartType, title, columns, rows);
    if (!option) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [chartType, title, columns, rows]);

  if (chartType === 'table') return null;
  return <div ref={ref} className="w-full h-72 mt-3 bg-white rounded border border-gray-200" />;
}

function ResultTable({ columns, rows }: { columns: string[]; rows: any[][] }) {
  return (
    <div className="overflow-auto max-h-64 mt-2 border rounded">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-left font-medium text-gray-700 border-b">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1 border-b text-gray-600 whitespace-nowrap">
                  {cell == null ? '-' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-xs text-gray-500 p-2">仅展示前 100 行</p>
      )}
    </div>
  );
}

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'line', label: '折线图' },
  { id: 'bar', label: '柱状图' },
  { id: 'pie', label: '饼图' },
  { id: 'table', label: '表格' },
];

export default function ReportPage() {
  const { activeProject, activeDataSource } = useProjectStore();
  const store = useReportStore();
  const {
    messages,
    isGenerating,
    formDescription,
    sessionKey,
    currentSql,
    currentTitle,
    currentChartType,
    currentQueryResult,
    leftPanelTab,
    searchKeyword,
    reportRecords,
    setFormDescription,
    setIsGenerating,
    addMessage,
    updateLastAssistantMessage,
    setCurrentSql,
    setCurrentTitle,
    setCurrentChartType,
    setCurrentQueryResult,
    setLeftPanelTab,
    setSearchKeyword,
    setReportRecords,
    newSession,
    loadFromRecord,
    setCurrentRecordId,
  } = store;

  const [templates, setTemplates] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(currentTitle);
  const [attachedFile, setAttachedFile] = useState<{ name: string; base64: string } | null>(null);
  const [toast, setToast] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chartExportRef = useRef<HTMLDivElement>(null);

  const projectId = activeProject?.id;
  const dataSourceId = activeDataSource?.id;
  const dbType = activeDataSource?.type;

  const loadSidebarData = useCallback(async () => {
    if (!projectId || !window.electronAPI?.report) return;
    const [history, tpls] = await Promise.all([
      window.electronAPI.report.getHistory(projectId),
      window.electronAPI.report.getTemplates(projectId),
    ]);
    setReportRecords(history);
    setTemplates(tpls);
    if (dataSourceId) {
      const rels = await window.electronAPI.report.getRelationships(dataSourceId);
      setRelationships(rels);
    }
  }, [projectId, dataSourceId, setReportRecords]);

  useEffect(() => {
    loadSidebarData();
  }, [loadSidebarData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  useEffect(() => {
    setTitleInput(currentTitle);
  }, [currentTitle]);

  useEffect(() => {
    if (!window.electronAPI?.report) return;
    return window.electronAPI.report.onStreamChunk(({ sessionKey: sk, chunk }) => {
      if (sk !== sessionKey) return;
      const msgs = useReportStore.getState().messages;
      let lastContent = '';
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          lastContent = msgs[i].content;
          break;
        }
      }
      updateLastAssistantMessage(lastContent + chunk);
    });
  }, [sessionKey, updateLastAssistantMessage]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  const saveCurrentReport = async () => {
    if (!projectId || !dataSourceId) return;
    const id = store.currentRecordId || `report_${Date.now()}`;
    await window.electronAPI.report.saveHistory({
      id,
      projectId,
      dataSourceId,
      title: currentTitle,
      description: messages.find((m) => m.role === 'user')?.content || '',
      sql: currentSql || '',
      queryResult: JSON.stringify(currentQueryResult),
      chartType: currentChartType,
      chartConfig: '{}',
      messages: JSON.stringify(messages),
    });
    setCurrentRecordId(id);
    await loadSidebarData();
  };

  const handleSend = async () => {
    const text = formDescription.trim();
    if (!text || isGenerating) return;
    if (!projectId || !dataSourceId || !dbType) {
      alert('请先在项目管理中选择项目并配置数据源');
      return;
    }

    let userContent = text;
    if (attachedFile) {
      const parsed = await window.electronAPI.report.parseExcel(attachedFile.base64, attachedFile.name);
      if (parsed.success) {
        const sheet = parsed.sheets[0];
        userContent += `\n\n[附件 Excel: ${attachedFile.name}]\n表头: ${sheet.headers.join(', ')}\n预览:\n${sheet.previewRows.map((r: any[]) => r.join('\t')).join('\n')}`;
      }
      setAttachedFile(null);
    }

    setFormDescription('');
    const userMsg: ReportMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: userContent,
    };
    addMessage(userMsg);
    addMessage({ id: `msg_${Date.now()}_ai`, role: 'assistant', content: '' });
    setIsGenerating(true);

    try {
      const result = await window.electronAPI.report.sendMessage({
        sessionKey,
        projectId,
        dataSourceId,
        dbType,
        message: userContent,
      });

      if (!result.success) {
        updateLastAssistantMessage(`❌ ${result.message}`);
        return;
      }

      const content = result.content || '';
      updateLastAssistantMessage(content);

      const action = extractReportAction(content);
      if (action?.action === 'chart_only' && action.chartType && currentQueryResult) {
        setCurrentChartType(action.chartType as ChartType);
        return;
      }

      const sql = extractSqlFromMarkdown(content);
      if (sql) {
        setCurrentSql(sql);
        setCurrentTitle(extractTitleFromMarkdown(content));
      }
    } catch (e) {
      updateLastAssistantMessage(`❌ ${(e as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteSql = async (sql?: string) => {
    const toRun = sql || currentSql;
    if (!toRun || !projectId || !dataSourceId || !dbType) return;

    setIsGenerating(true);
    try {
      const result = await window.electronAPI.report.executeQuery({
        sessionKey,
        projectId,
        dataSourceId,
        dbType,
        sql: toRun,
      });

      if (!result.success) {
        alert(`执行失败：${result.message}`);
        return;
      }

      const qr = {
        columns: result.columns || [],
        rows: result.rows || [],
        rowCount: result.rowCount || 0,
        executionTime: result.executionTime || 0,
      };
      setCurrentQueryResult(qr);
      const chart = inferChartType(qr.columns, qr.rows);
      setCurrentChartType(chart);

      if (qr.rowCount === 0) {
        addMessage({
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: '查询结果为空，建议扩大时间范围或检查筛选条件。',
          isConfirm: true,
        });
      }

      await saveCurrentReport();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRerun = () => {
    if (currentSql) handleExecuteSql(currentSql);
  };

  const onFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setAttachedFile({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  };

  const filteredHistory = reportRecords.filter(
    (r) =>
      !searchKeyword ||
      r.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      r.description.toLowerCase().includes(searchKeyword.toLowerCase())
  );
  const grouped = groupHistoryByTime(filteredHistory);

  if (!window.electronAPI?.report) {
    return <div className="p-8 text-gray-500">报表模块未加载</div>;
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-gray-50">
      {toast && (
        <div className="fixed top-16 right-4 z-50 bg-gray-800 text-white text-sm px-3 py-2 rounded shadow">
          {toast}
        </div>
      )}

      {/* 左侧面板 */}
      <aside className="w-80 border-r bg-white flex flex-col shrink-0">
        <div className="flex border-b">
          {(['history', 'templates', 'relationships'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setLeftPanelTab(tab)}
              className={`flex-1 py-2 text-xs font-medium ${
                leftPanelTab === tab ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-500'
              }`}
            >
              {tab === 'history' ? '📋 历史' : tab === 'templates' ? '📁 模板' : '🔗 关系'}
            </button>
          ))}
        </div>

        {leftPanelTab === 'history' && (
          <div className="flex-1 flex flex-col overflow-hidden p-2">
            <input
              placeholder="搜索标题..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="mb-2 px-2 py-1 text-sm border rounded"
            />
            <button
              onClick={newSession}
              className="mb-2 text-xs bg-blue-500 text-white py-1.5 rounded hover:bg-blue-600"
            >
              + 新建报表
            </button>
            <div className="flex-1 overflow-y-auto space-y-3">
              {Object.entries(grouped).map(([label, items]) =>
                items.length > 0 ? (
                  <div key={label}>
                    <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
                    {items.map((r: ReportRecord) => (
                      <div
                        key={r.id}
                        onClick={() => loadFromRecord(r)}
                        className={`p-2 rounded cursor-pointer text-sm mb-1 ${
                          store.currentRecordId === r.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                        }`}
                      >
                        <p className="font-medium truncate">{r.title}</p>
                        <p className="text-xs text-gray-400 truncate">{(r.sql || '').slice(0, 50)}</p>
                      </div>
                    ))}
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        {leftPanelTab === 'templates' && (
          <div className="flex-1 overflow-y-auto p-2 text-sm">
            {templates.length === 0 ? (
              <p className="text-gray-400 text-center py-4">暂无模板</p>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="p-2 border rounded mb-2 hover:bg-gray-50">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-gray-500">{t.description}</p>
                  <button
                    className="text-xs text-blue-600 mt-1"
                    onClick={() => {
                      setCurrentSql(t.sqlTemplate);
                      setCurrentChartType(t.chartType || 'bar');
                    }}
                  >
                    应用
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {leftPanelTab === 'relationships' && (
          <div className="flex-1 overflow-y-auto p-2 text-xs">
            <div className="flex justify-between mb-2">
              <span className="text-gray-500">
                已验证({relationships.filter((r) => r.isValid === 1).length}) / 待验证(
                {relationships.filter((r) => r.isValid !== 1).length})
              </span>
              {dataSourceId && (
                <button
                  className="text-red-500"
                  onClick={async () => {
                    if (confirm('清空所有表关系？')) {
                      await window.electronAPI.report.clearRelationships(dataSourceId);
                      loadSidebarData();
                    }
                  }}
                >
                  清空
                </button>
              )}
            </div>
            {relationships.map((r) => (
              <div
                key={r.id}
                className={`p-2 mb-1 rounded border ${
                  r.isValid === 1 ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'
                }`}
              >
                <p>
                  {r.leftTable}.{r.leftColumn} → {r.rightTable}.{r.rightColumn}
                </p>
                <p className="text-gray-400">{r.joinType}</p>
                <button
                  className="text-red-500 mt-1"
                  onClick={async () => {
                    await window.electronAPI.report.deleteRelationship(r.id);
                    loadSidebarData();
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* 右侧对话区 */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg mb-2">AI 报表</p>
              <p className="text-sm">用自然语言描述报表需求，AI 将生成 SQL 与图表</p>
              {!dataSourceId && (
                <p className="text-amber-600 text-sm mt-4">请先在项目管理中配置数据源，并在数据查询中加载表结构</p>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : msg.isConfirm
                      ? 'bg-amber-50 border border-amber-200 text-gray-800'
                      : 'bg-white border border-gray-200 shadow-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <MarkdownContent content={msg.content || (isGenerating ? '思考中...' : '')} />
                )}
              </div>
            </div>
          ))}

          {currentSql && (
            <div className="bg-white border rounded-lg p-4 shadow-sm">
              {editingTitle ? (
                <input
                  className="font-semibold border-b w-full mb-2"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={() => {
                    setCurrentTitle(titleInput);
                    setEditingTitle(false);
                    saveCurrentReport();
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  autoFocus
                />
              ) : (
                <h3
                  className="font-semibold text-gray-800 mb-2 cursor-pointer"
                  onDoubleClick={() => setEditingTitle(true)}
                  title="双击编辑标题"
                >
                  {currentTitle}
                </h3>
              )}
              <pre className="bg-slate-900 text-green-400 p-3 rounded text-xs overflow-x-auto">{currentSql}</pre>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => handleExecuteSql()}
                  disabled={isGenerating}
                  className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  执行查询
                </button>
                <button
                  onClick={async () => {
                    await copyToClipboard(currentSql);
                    showToast('SQL 已复制');
                  }}
                  className="px-3 py-1.5 border text-sm rounded hover:bg-gray-50"
                >
                  复制 SQL
                </button>
                <button onClick={handleRerun} className="px-3 py-1.5 border text-sm rounded hover:bg-gray-50">
                  重跑
                </button>
              </div>
            </div>
          )}

          {currentQueryResult && (
            <div className="bg-white border rounded-lg p-4 shadow-sm" ref={chartExportRef}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">
                  {currentQueryResult.rowCount} 行 · {currentQueryResult.executionTime}ms
                </span>
                <div className="flex gap-1">
                  {CHART_TYPES.map((ct) => (
                    <button
                      key={ct.id}
                      onClick={() => setCurrentChartType(ct.id)}
                      className={`px-2 py-0.5 text-xs rounded ${
                        currentChartType === ct.id ? 'bg-blue-500 text-white' : 'bg-gray-100'
                      }`}
                    >
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>
              <EChartPanel
                chartType={currentChartType}
                title={currentTitle}
                columns={currentQueryResult.columns}
                rows={currentQueryResult.rows}
              />
              <ResultTable columns={currentQueryResult.columns} rows={currentQueryResult.rows} />
              <div className="flex gap-2 mt-3">
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  onClick={() => exportCsv(currentQueryResult.columns, currentQueryResult.rows, currentTitle)}
                >
                  导出 CSV
                </button>
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  onClick={() => exportExcel(currentQueryResult.columns, currentQueryResult.rows, currentTitle)}
                >
                  导出 Excel
                </button>
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  onClick={async () => {
                    const el = chartExportRef.current?.querySelector('canvas')?.parentElement;
                    if (!el) return;
                    const chart = echarts.getInstanceByDom(el as HTMLElement);
                    if (!chart) return;
                    const url = chart.getDataURL({ type: 'png', pixelRatio: 2 });
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${currentTitle}.png`;
                    a.click();
                  }}
                >
                  导出图片
                </button>
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  onClick={async () => {
                    const name = prompt('模板名称');
                    if (!name || !projectId || !dataSourceId) return;
                    await window.electronAPI.report.saveTemplate({
                      projectId,
                      dataSourceId,
                      name,
                      description: '',
                      sqlTemplate: currentSql || '',
                      parameters: '[]',
                      chartType: currentChartType,
                    });
                    loadSidebarData();
                    showToast('模板已保存');
                  }}
                >
                  保存为模板
                </button>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* 输入区 */}
        <div
          className="border-t bg-white p-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onFileDrop}
        >
          {attachedFile && (
            <div className="text-xs text-blue-600 mb-1 flex items-center gap-2">
              📎 {attachedFile.name}
              <button onClick={() => setAttachedFile(null)} className="text-gray-400">
                ×
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入报表需求，可拖拽 Excel 文件..."
              rows={2}
              className="flex-1 border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleSend}
              disabled={!formDescription.trim() || isGenerating}
              className="px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 self-end"
            >
              {isGenerating ? '...' : '发送'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
