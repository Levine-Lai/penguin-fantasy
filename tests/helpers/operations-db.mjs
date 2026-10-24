import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_operations.sql', '0002_player_logins.sql', '0003_published_rounds.sql', '0004_duel_queue.sql']) {
    sqlite.exec(readFileSync(new URL(`../../cloudflare/fpl-proxy/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const wrap = (query, values = []) => ({
    bind(...args) { return wrap(query, args); },
    async first() { return sqlite.prepare(query).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { meta: sqlite.prepare(query).run(...values) }; },
  });
  // Model D1's serialized atomic batches instead of allowing nested SQLite BEGINs.
  let tail = Promise.resolve();
  return { sqlite, prepare: query => wrap(query), batch(statements) {
    const result = tail.then(async () => {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    tail = result.catch(() => {});
    return result;
  } };
}
