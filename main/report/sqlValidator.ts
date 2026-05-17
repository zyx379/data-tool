export type SqlValidationMode = 'select_only' | 'data_access';

const FORBIDDEN_KEYWORDS = [
  'DROP', 'ALTER', 'TRUNCATE', 'DELETE', 'CREATE', 'GRANT', 'REVOKE',
  'EXEC', 'EXECUTE', 'MERGE', 'CALL',
];

const ALLOWED_IN_DATA_ACCESS = ['SELECT', 'INSERT', 'UPDATE'];

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedSql?: string;
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function firstKeyword(sql: string): string {
  const cleaned = stripComments(sql).trim();
  const match = cleaned.match(/^(\w+)/i);
  return match ? match[1].toUpperCase() : '';
}

function containsForbidden(sql: string): string | null {
  const upper = stripComments(sql).toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(upper)) {
      return kw;
    }
  }
  return null;
}

function hasWhereClause(sql: string): boolean {
  return /\bWHERE\b/i.test(stripComments(sql));
}

export function validateSql(sql: string, mode: SqlValidationMode = 'select_only'): SqlValidationResult {
  const trimmed = sql?.trim();
  if (!trimmed) {
    return { valid: false, reason: 'SQL 不能为空' };
  }

  const forbidden = containsForbidden(trimmed);
  if (forbidden) {
    return { valid: false, reason: `禁止执行包含 ${forbidden} 的 SQL` };
  }

  const keyword = firstKeyword(trimmed);

  if (mode === 'select_only') {
    if (keyword !== 'SELECT') {
      return { valid: false, reason: '智能报表仅允许 SELECT 查询' };
    }
    if (/\b(INSERT|UPDATE|DELETE)\b/i.test(stripComments(trimmed))) {
      return { valid: false, reason: '智能报表仅允许 SELECT 查询' };
    }
    return { valid: true, normalizedSql: trimmed };
  }

  if (!ALLOWED_IN_DATA_ACCESS.includes(keyword)) {
    return {
      valid: false,
      reason: `数据接入仅允许 ${ALLOWED_IN_DATA_ACCESS.join(' / ')} 语句`,
    };
  }

  if ((keyword === 'UPDATE' || keyword === 'INSERT') && keyword === 'UPDATE' && !hasWhereClause(trimmed)) {
    return { valid: false, reason: 'UPDATE 语句必须包含 WHERE 条件' };
  }

  return { valid: true, normalizedSql: trimmed };
}

export function ensureRowLimit(sql: string, dbType: 'oracle' | 'dameng', limit = 500): string {
  const upper = stripComments(sql).toUpperCase();
  if (dbType === 'oracle') {
    if (/\bROWNUM\b/i.test(upper)) return sql;
    return `SELECT * FROM (${sql}) WHERE ROWNUM <= ${limit}`;
  }
  if (/\bTOP\s+\d+/i.test(upper)) return sql;
  return sql.replace(/^\s*SELECT\b/i, `SELECT TOP ${limit}`);
}
