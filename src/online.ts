// The online leaderboard (server/worker.ts): who this player is (an id and the secret key joining gave them), their
// full-run PBs going up (queued in this browser until they go through) and everyone's times.
export interface Me { id: string; key: string; name: string }
export interface Entry { id: string; name: string; time: number; splits: (number | null)[]; at: number }
export type Summary = Record<string, { name: string; time: number; n: number; rank?: number }>;
export interface Upload { map: string; tick: number; time: number; splits: (number | null)[] }

const get = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const API = get<string | null>('surf.api', null) ?? 'https://surf-board.angongod.workers.dev'; // surf.api: a test server instead

async function api<T>(path: string, o: { body?: object; admin?: string } = {}): Promise<T> {
  const r = await fetch(API + path, o.body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.body) } : o.admin ? { method: 'DELETE', headers: { 'x-admin-key': o.admin } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `the leaderboard answered ${r.status}`), { status: r.status });
  return j;
}

export const me = () => get<Me | null>('surf.me', null);
export const code = (m: Me) => `${m.id}-${m.key}`;
export const uploading = () => get('surf.upload', true);
export const setUploading = (on: boolean) => put('surf.upload', on);
export async function join(name: string) { const m = await api<Me>('/join', { body: { name } }); put('surf.me', m); return m; }
export async function rename(name: string) { const m = me()!, r = await api<Me>('/rename', { body: { id: m.id, key: m.key, name } }); put('surf.me', { ...m, name: r.name }); return r.name; }
export async function useCode(c: string) { const [id = '', key = ''] = c.trim().split('-'), r = await api<Me>('/me', { body: { id, key } }); put('surf.me', { id, key, name: r.name }); return r.name; }
export const board = (map: string, tick: number) => api<Entry[]>(`/board?map=${map}&tick=${tick}`);
export const summary = (tick: number) => api<Summary>(`/summary?tick=${tick}&id=${me()?.id ?? ''}`);
export const remove = (admin: string, what: string) => api(`/${what}`, { admin }); // 'time?id=&map=&tick=' or 'player?id='

/** Queue PBs (the best per map and tick rate) and send the queue; resolves to the first one's rank if it went up. */
export function upload(...us: Upload[]) {
  const q = get<Upload[]>('surf.queue', []);
  for (const u of us) { const i = q.findIndex(x => x.map === u.map && x.tick === u.tick); if (i < 0) q.push(u); else if (u.time < q[i].time) q[i] = u; }
  put('surf.queue', q);
  return flush().then(done => done[`${us[0]?.map}@${us[0]?.tick}`]);
}
let busy: Promise<Record<string, number>> = Promise.resolve({});
/** Send what's queued, in order. Offline, busy or a server fault: it stays for next time; a rejected time is dropped. */
export function flush() {
  const send = async () => {
    const m = me(), done: Record<string, number> = {};
    if (!m || !uploading()) return done;
    for (const u of get<Upload[]>('surf.queue', [])) {
      try { done[`${u.map}@${u.tick}`] = (await api<{ rank: number }>('/time', { body: { id: m.id, key: m.key, ...u } })).rank; }
      catch (e) { const s = (e as { status?: number }).status; if (!s || s >= 500 || s === 429) break; }
      put('surf.queue', get<Upload[]>('surf.queue', []).filter(x => x.map !== u.map || x.tick !== u.tick || x.time < u.time));
    }
    return done;
  };
  return (busy = busy.then(send, send));
}
