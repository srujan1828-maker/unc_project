import { existsSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { openStore, hash } from './store.js';

// Local filesystem administration only. There is deliberately no HTTP issuance endpoint.
export function createOwnerRecovery(dataDir) {
  const directory = resolve(dataDir);
  if (!existsSync(join(directory, 'omnisync.sqlite')))
    throw new Error('No workspace database exists at this data directory.');
  const store = openStore(directory);
  const key = randomBytes(32).toString('base64url');
  const path = join(directory, 'recovery-key');
  const temporary = join(directory, `.recovery-${randomBytes(8).toString('hex')}.tmp`);
  const expiresAt = Date.now() + 10 * 60_000;
  try {
    store.db.exec('BEGIN IMMEDIATE');
    if (!store.one("SELECT id FROM devices WHERE role='owner' AND revoked=0"))
      throw new Error('Initialize the workspace before using owner recovery.');
    store.run(
      "INSERT INTO settings(key,value) VALUES('ownerRecovery',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify({ hash: hash(key), expiresAt }),
    );
    writeFileSync(temporary, key + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    store.db.exec('COMMIT');
    return { path, expiresAt };
  } catch (error) {
    try {
      store.db.exec('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    rmSync(temporary, { force: true });
    store.db.close();
  }
}
