// The online leaderboard: a Cloudflare Worker over a D1 database (schema.sql). A player joins with a name and gets a
// secret key (only its SHA-256 is kept); each player's full-run time per map and tick rate is replaced only by a faster
// one. Honour system: times are sanity checked (a known map, no faster than about 0.7 x its fast run, at most an hour)
// and writes are rate limited; the admin key (a Worker secret) deletes times and players.
// Redeploy after changing this file: cd server && npx wrangler deploy (the schema: npx wrangler d1 execute surf-board
// --remote --file=schema.sql). Local: npx wrangler dev (a local D1; ADMIN_KEY from .dev.vars).

/** The maps on the board and their fast runs in seconds (MapDef.difficulty.run; the tests keep them in step). */
export const RUNS: Record<string, number> = { aircontrol: 36, aircontrol_v3: 36, cyberwave: 58, gauntlet: 77, kitsune: 59, mesa: 49, progress: 60, stages: 52, utopia: 33, utopia_v3: 54 };

interface Stmt { bind(...v: unknown[]): Stmt; first<T = Row>(): Promise<T | null>; all<T = Row>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
interface Env { DB: { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown> }; ADMIN_KEY?: string }
type Row = Record<string, unknown>;

const ORIGIN = /^(https:\/\/angongod\.github\.io|http:\/\/(localhost|127\.0\.0\.1):(5173|4173))$/;
const NAME = /^[A-Za-z0-9 _.-]{1,24}$/;
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
class Fail extends Error { constructor(readonly status: number, msg: string) { super(msg); } }
const check = (ok: unknown, status: number, msg: string) => { if (!ok) throw new Fail(status, msg); };
const RANK = '(SELECT COUNT(*) FROM times b WHERE b.map = a.map AND b.tick = a.tick AND b.time < a.time) + 1';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin') ?? '', headers = {
      'access-control-allow-origin': ORIGIN.test(origin) ? origin : 'https://angongod.github.io', vary: 'origin',
      'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, x-admin-key', 'cache-control': 'no-store',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    try { return Response.json(await route(req, env, new URL(req.url)), { headers }); }
    catch (e) { return Response.json({ error: e instanceof Fail ? e.message : 'server error' }, { status: e instanceof Fail ? e.status : 500, headers }); }
  },
};

async function route(req: Request, { DB: db, ADMIN_KEY }: Env, url: URL) {
  const q = (k: string) => url.searchParams.get(k) ?? '', path = `${req.method} ${url.pathname}`, now = Date.now();
  if (path === 'GET /board') {
    const { results } = await db.prepare('SELECT p.id, p.name, t.time, t.splits, t.at FROM times t JOIN players p ON p.id = t.player WHERE t.map = ? AND t.tick = ? ORDER BY t.time, t.at').bind(q('map'), +q('tick')).all();
    return results.map(r => ({ ...r, splits: JSON.parse(r.splits as string) }));
  }
  if (path === 'GET /summary') { // per map: the fastest (SQLite takes the bare columns from the MIN row), how many, my rank
    const { results } = await db.prepare('SELECT map, name, MIN(time) AS time, COUNT(*) AS n FROM times JOIN players ON id = player WHERE tick = ? GROUP BY map').bind(+q('tick')).all();
    const mine = (await db.prepare(`SELECT map, ${RANK} AS rank FROM times a WHERE player = ? AND tick = ?`).bind(q('id'), +q('tick')).all()).results;
    return Object.fromEntries(results.map(({ map, ...r }) => [map, { ...r, rank: mine.find(m => m.map === map)?.rank }]));
  }
  if (req.method === 'DELETE') {
    check(ADMIN_KEY && req.headers.get('x-admin-key') === ADMIN_KEY, 403, 'not allowed');
    if (url.pathname === '/time') await db.prepare('DELETE FROM times WHERE player = ? AND map = ? AND tick = ?').bind(q('id'), q('map'), +q('tick')).run();
    else if (url.pathname === '/player') await db.batch([db.prepare('DELETE FROM times WHERE player = ?').bind(q('id')), db.prepare('DELETE FROM players WHERE id = ?').bind(q('id'))]);
    else throw new Fail(404, 'not found');
    return { ok: true };
  }
  check(req.method === 'POST', 404, 'not found');
  const b = (await req.json().catch(() => ({}))) as Row, ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (path === 'POST /join') {
    await limit(db, `join:${ip}`, now, 10, 3_600_000);
    check(NAME.test(name), 400, 'names are 1-24 letters, digits, spaces and _ - .');
    const id = rand(8), key = rand(24);
    await db.prepare('INSERT INTO players (id, name, key_hash, created) VALUES (?, ?, ?, ?)').bind(id, name, await sha(key), now).run().catch(() => { throw new Fail(409, 'that name is taken'); });
    return { id, key, name };
  }
  const p = typeof b.id === 'string' && typeof b.key === 'string' ? await db.prepare('SELECT id, name, key_hash FROM players WHERE id = ?').bind(b.id).first() : null;
  check(p && p.key_hash === (await sha(b.key as string)), 403, 'unknown player');
  await limit(db, `ip:${ip}`, now, 120);
  await limit(db, `p:${p!.id}`, now, 40);
  if (path === 'POST /me') return { id: p!.id, name: p!.name };
  if (path === 'POST /rename') {
    check(NAME.test(name), 400, 'names are 1-24 letters, digits, spaces and _ - .');
    await db.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, p!.id).run().catch(() => { throw new Fail(409, 'that name is taken'); });
    return { id: p!.id, name };
  }
  check(path === 'POST /time', 404, 'not found');
  const { map, tick, time, splits = [] } = b as { map: string; tick: number; time: number; splits: unknown };
  check(typeof map === 'string' && Object.hasOwn(RUNS, map), 400, 'not a map on the board');
  check(tick === 128 || tick === 256, 400, 'only 128 and 256 tick times count');
  check(typeof time === 'number' && time >= 0.7 * RUNS[map] && time <= 3600, 400, 'not a believable time');
  check(Array.isArray(splits) && splits.length <= 64 && splits.every(s => s === null || (typeof s === 'number' && s >= 0 && s <= time)), 400, 'bad splits');
  await db.prepare('INSERT INTO times (player, map, tick, time, splits, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (player, map, tick) DO UPDATE SET time = excluded.time, splits = excluded.splits, at = excluded.at WHERE excluded.time < times.time')
    .bind(p!.id, map, tick, time, JSON.stringify(splits), now).run();
  return db.prepare(`SELECT time, ${RANK} AS rank FROM times a WHERE player = ? AND map = ? AND tick = ?`).bind(p!.id, map, tick).first();
}

/** At most `max` writes per `per` ms for `who` (an IP or a player); old marks are swept now and then. */
async function limit(db: Env['DB'], who: string, now: number, max: number, per = 60_000) {
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE who = ? AND at > ?').bind(who, now - per).first())?.n as number;
  check(n < max, 429, 'too many requests: try again later');
  await db.batch([db.prepare('INSERT INTO hits (who, at) VALUES (?, ?)').bind(who, now), ...(Math.random() < 0.05 ? [db.prepare('DELETE FROM hits WHERE at < ?').bind(now - 3_600_000)] : [])]);
}
