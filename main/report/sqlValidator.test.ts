import { validateSql, ensureRowLimit } from './sqlValidator';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// SELECT only
assert(validateSql('SELECT * FROM T').valid, 'simple select');
assert(!validateSql('DELETE FROM T').valid, 'delete blocked');
assert(!validateSql('DROP TABLE T').valid, 'drop blocked');

// data access mode
assert(validateSql('INSERT INTO T (A) VALUES (1)', 'data_access').valid, 'insert ok');
assert(!validateSql('UPDATE T SET A=1', 'data_access').valid, 'update without where blocked');
assert(validateSql('UPDATE T SET A=1 WHERE ID=1', 'data_access').valid, 'update with where ok');

// row limit
const limited = ensureRowLimit('SELECT * FROM ORDERS', 'oracle');
assert(limited.includes('ROWNUM'), 'oracle rownum wrapper');
const dm = ensureRowLimit('SELECT * FROM ORDERS', 'dameng');
assert(dm.includes('TOP'), 'dameng top wrapper');

console.log('sqlValidator tests passed');
