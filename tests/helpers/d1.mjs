/**
 * A D1 stand-in for tests, over node:sqlite.
 *
 * Small on purpose: it implements the slice of the D1 client the app actually
 * uses — prepare/bind/first/all/run and batch — against the same migration SQL
 * that runs in production, so the tests exercise the real queries rather than a
 * mock of them.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const normalise = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  return String(v);
};

const plain = (row) => (row ? { ...row } : row);

export function createTestD1() {
  const sqlite = new DatabaseSync(':memory:');
  // FORECOURT_SCHEMA runs the suite against a schema dumped from a real D1
  // database instead of the migrations — the way to prove that what is
  // actually deployed still satisfies the app, not just what should be.
  if (process.env.FORECOURT_SCHEMA) {
    sqlite.exec(readFileSync(process.env.FORECOURT_SCHEMA, 'utf8'));
  } else {
    for (const file of readdirSync(join(root, 'migrations')).sort()) {
      if (file.endsWith('.sql')) sqlite.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
    }
  }

  const statement = (sql, params) => ({
    bind: (...args) => statement(sql, args.map(normalise)),
    async first() {
      return plain(sqlite.prepare(sql).get(...params)) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...params).map(plain), success: true };
    },
    async run() {
      const res = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid) } };
    },
    _sql: sql,
    _params: params,
  });

  return {
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    _sqlite: sqlite,
  };
}

/** A Worker env with a fresh database and no third-party lookup keys. */
export function testEnv() {
  return {
    DB: createTestD1(),
    ASSETS: { fetch: async () => new Response('<!doctype html>app shell', { headers: { 'content-type': 'text/html' } }) },
  };
}
