/** 用于合并表结构缓存：Oracle/达梦表名比较不区分大小写 */

export function schemaTableKey(tableName: string): string {
  return tableName.trim().toUpperCase();
}

/** 增量合并：保留未出现在本次加载中的旧表；已存在的表用新数据覆盖；新表追加在后 */
export function mergeSchemaIncremental(existing: any[], incoming: any[]): any[] {
  const incomingByKey = new Map(incoming.map((t) => [schemaTableKey(t.tableName), t] as const));
  const usedIncoming = new Set<string>();
  const result: any[] = [];

  for (const t of existing) {
    const k = schemaTableKey(t.tableName);
    const repl = incomingByKey.get(k);
    if (repl) {
      result.push(repl);
      usedIncoming.add(k);
    } else {
      result.push(t);
    }
  }
  for (const t of incoming) {
    const k = schemaTableKey(t.tableName);
    if (!usedIncoming.has(k)) {
      result.push(t);
      usedIncoming.add(k);
    }
  }
  return result;
}
