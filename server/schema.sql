-- The online leaderboard's tables (D1: SQLite). Apply: npx wrangler d1 execute surf-board --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, key_hash TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS times (player TEXT NOT NULL, map TEXT NOT NULL, tick INTEGER NOT NULL, time REAL NOT NULL, splits TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (player, map, tick));
CREATE INDEX IF NOT EXISTS times_by_map ON times (map, tick, time);
CREATE TABLE IF NOT EXISTS hits (who TEXT NOT NULL, at INTEGER NOT NULL); -- rate limiting
CREATE INDEX IF NOT EXISTS hits_by_who ON hits (who, at);
