import { getSchemaCache, getActiveProjectWithDetails } from '../../database/sqlite';
import { ToolResult } from '../types';

export async function getTableSchema(
  tableNamePattern: string,
  dataSourceId?: string
): Promise<ToolResult> {
  try {
    let targetDataSourceId = dataSourceId;

    if (!targetDataSourceId) {
      const activeDetails = getActiveProjectWithDetails();
      if (activeDetails.dataSource) {
        targetDataSourceId = activeDetails.dataSource.id;
      }
    }

    if (!targetDataSourceId) {
      return { success: false, error: '未找到激活的数据源，无法查询表结构' };
    }

    const cache = getSchemaCache(targetDataSourceId, undefined, true);
    if (!cache || !cache.schemaData || cache.schemaData.length === 0) {
      return { success: false, error: '表结构缓存为空，请先在数据查询页面加载表结构' };
    }

    const patternLower = tableNamePattern.toLowerCase();
    const matchedTables = cache.schemaData.filter((table: any) => {
      const tableName = (table.tableName || '').toLowerCase();
      const comments = (table.comments || '').toLowerCase();
      return tableName.includes(patternLower) || comments.includes(patternLower);
    });

    if (matchedTables.length === 0) {
      return {
        success: true,
        data: {
          pattern: tableNamePattern,
          matchedCount: 0,
          tables: [],
          hint: `未找到包含 "${tableNamePattern}" 的表。可用的表关键词建议：尝试更短的关键词或查看所有表。`
        }
      };
    }

    const tableSchemas = matchedTables.map((table: any) => ({
      tableName: table.tableName,
      comments: table.comments,
      columnCount: table.columns?.length || 0,
      columns: (table.columns || []).map((col: any) => ({
        columnName: col.columnName,
        dataType: col.dataType,
        comments: col.comments,
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
      })),
    }));

    return {
      success: true,
      data: {
        pattern: tableNamePattern,
        matchedCount: matchedTables.length,
        totalTablesInCache: cache.schemaData.length,
        tables: tableSchemas.slice(0, 10),
      }
    };
  } catch (error) {
    console.error('getTableSchema error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildTableSchemaPrompt(args: any, result: any): string {
  let prompt = `## 表结构查询结果\n\n`;
  prompt += `**查询关键词**: ${args.tableNamePattern}\n`;
  prompt += `**匹配表数**: ${result.matchedCount}（缓存共 ${result.totalTablesInCache} 张表）\n\n`;

  if (result.matchedCount === 0) {
    prompt += `未找到匹配的表结构。${result.hint || ''}\n`;
    return prompt;
  }

  result.tables.forEach((table: any, index: number) => {
    prompt += `### ${index + 1}. ${table.tableName}`;
    if (table.comments) {
      prompt += ` - ${table.comments}`;
    }
    prompt += `\n`;
    prompt += `**列信息** (${table.columnCount} 列):\n`;

    if (table.columns && table.columns.length > 0) {
      prompt += `| 列名 | 类型 | 注释 | 可空 | 主键 |\n`;
      prompt += `|------|------|------|------|------|\n`;
      table.columns.forEach((col: any) => {
        const pk = col.isPrimaryKey ? '🔑' : '';
        const nullable = col.nullable === 'Y' ? '是' : '否';
        prompt += `| ${col.columnName} | ${col.dataType} | ${col.comments || ''} | ${nullable} | ${pk} |\n`;
      });
    }
    prompt += `\n`;
  });

  prompt += `\n请根据以上表结构信息，结合日志和代码分析，继续排查问题。`;
  return prompt;
}