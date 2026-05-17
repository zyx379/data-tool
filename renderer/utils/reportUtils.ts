export type ChartType = 'line' | 'bar' | 'pie' | 'table';

export interface QueryResultData {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export function extractSqlFromMarkdown(content: string): string | null {
  const match = content.match(/```sql\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export function extractTitleFromMarkdown(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('```'));
  return firstLine?.slice(0, 40) || '未命名报表';
}

export function extractReportAction(content: string): { action: string; chartType?: ChartType } | null {
  const match = content.match(/```report-action\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

export function inferChartType(
  columns: string[],
  rows: any[][],
  userHint?: string
): ChartType {
  if (userHint === 'line' || userHint === 'bar' || userHint === 'pie' || userHint === 'table') {
    return userHint;
  }
  if (!columns.length || !rows.length) return 'table';
  if (rows.length > 50) return 'table';

  const firstCol = rows.map((r) => r[0]);
  const dateLike = firstCol.filter((v) => {
    const s = String(v);
    return /^\d{4}[-/]/.test(s) || s.includes('月');
  }).length;

  if (dateLike > rows.length * 0.5 && columns.length >= 2) return 'line';

  if (columns.length === 2 && rows.length <= 20) {
    const nums = rows.map((r) => Number(r[1])).filter((n) => !isNaN(n));
    if (nums.length === rows.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      if (sum > 0) return 'pie';
    }
    return 'bar';
  }

  if (columns.length >= 2 && rows.length <= 50) return 'bar';
  return 'table';
}

export function buildEChartsOption(
  chartType: ChartType,
  title: string,
  columns: string[],
  rows: any[][]
): Record<string, unknown> | null {
  if (chartType === 'table' || !columns.length) return null;

  const labels = rows.map((r) => String(r[0] ?? ''));
  const seriesData = rows.map((r) => {
    const v = r[1];
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  });

  const base = {
    title: { text: title, left: 'center' },
    tooltip: { trigger: chartType === 'pie' ? 'item' : 'axis' },
  };

  if (chartType === 'pie') {
    const limited = rows.slice(0, 20);
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: '55%',
          data: limited.map((r) => ({
            name: String(r[0]),
            value: Number(r[1]) || 0,
          })),
          label: { formatter: '{b}: {d}%' },
        },
      ],
    };
  }

  return {
    ...base,
    grid: { left: 60, right: 24, bottom: labels.some((l) => l.length > 6) ? 80 : 48 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { rotate: labels.some((l) => l.length > 8) ? 35 : 0, interval: 0 },
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: chartType,
        data: seriesData,
        smooth: chartType === 'line',
      },
    ],
  };
}

export function groupHistoryByTime(records: { createdAt: string }[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

  const groups: Record<string, typeof records> = {
    今天: [],
    昨天: [],
    本周: [],
    更早: [],
  };

  for (const r of records) {
    const d = new Date(r.createdAt);
    if (d >= todayStart) groups['今天'].push(r);
    else if (d >= yesterdayStart) groups['昨天'].push(r);
    else if (d >= weekStart) groups['本周'].push(r);
    else groups['更早'].push(r);
  }
  return groups;
}

export function exportCsv(columns: string[], rows: any[][], fileName: string) {
  const bom = '\uFEFF';
  const header = columns.join(',');
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? '' : String(cell);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\n');
  const blob = new Blob([bom + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${fileName}.csv`);
}

export async function exportExcel(columns: string[], rows: any[][], fileName: string) {
  const XLSX = await import('xlsx');
  const data = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `${fileName}.xlsx`);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
