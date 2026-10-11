import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const id = () => randomUUID();
export const defaults = {
  clipboard: true,
  files: true,
  chat: true,
  notifications: true,
  screen: false,
};

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  mkdirSync(join(directory, 'files'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'omnisync.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL,
      role TEXT NOT NULL, permissions TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL, lastSeen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES devices(id), expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invitations (
      hash TEXT PRIMARY KEY, role TEXT NOT NULL, permissions TEXT NOT NULL,
      expiresAt INTEGER NOT NULL, createdBy TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, text TEXT NOT NULL,
      target TEXT, pinned INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, target TEXT, name TEXT NOT NULL,
      size INTEGER NOT NULL, sha256 TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, createdAt INTEGER NOT NULL, completedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, text TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, target TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, deviceId TEXT,
      action TEXT NOT NULL, detail TEXT NOT NULL, createdAt INTEGER NOT NULL,
      previousHash TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_device ON sessions(deviceId);
    CREATE INDEX IF NOT EXISTS clips_created ON clips(createdAt);
  `);
  chmodSync(join(directory, 'omnisync.sqlite'), 0o600);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  function audit(deviceId, action, detail) {
    const event = { id: id(), deviceId, action, detail, createdAt: Date.now() };
    const previousHash =
      one('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')?.hash || '0'.repeat(64);
    const digest = hash(JSON.stringify({ ...event, previousHash }));
    run(
      'INSERT INTO audit (id,deviceId,action,detail,createdAt,previousHash,hash) VALUES (?,?,?,?,?,?,?)',
      event.id,
      deviceId,
      action,
      detail,
      event.createdAt,
      previousHash,
      digest,
    );
  }
  return { db, one, all, run, audit, directory };
}
