import express from 'express';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  createReadStream,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { open, rename, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { openStore, hash, id, defaults } from './store.js';
import { installCollaboration } from './collaboration.js';

const permissionsSchema = z.object({
  clipboard: z.boolean(),
  files: z.boolean(),
  chat: z.boolean(),
  notifications: z.boolean(),
  screen: z.boolean(),
});
const nameSchema = z.string().trim().min(1).max(60);
const platformSchema = z.enum(['macOS', 'Windows', 'Linux', 'Android', 'iOS', 'Browser', 'CLI']);
const targetSchema = z.string().uuid().nullable().optional();
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const CHUNK_SIZE = 1024 * 1024;
const SESSION_AGE = 90 * 24 * 60 * 60 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const publicDevice = (d) => ({
  ...d,
  permissions: JSON.parse(d.permissions),
  revoked: Boolean(d.revoked),
});

export function createOmniServer(options = {}) {
  const store = openStore(resolve(options.dataDir || '.omnisync'));
  const { one, all, run, audit } = store;
  // Recover a crash between verified-file rename and the SQLite commit.
  // Move back to partial state so the normal completion path verifies it again.
  for (const item of all("SELECT id FROM transfers WHERE status='uploading'")) {
    const final = join(store.directory, 'files', item.id);
    const partial = final + '.part';
    if (existsSync(final) && !existsSync(partial)) renameSync(final, partial);
    if (!existsSync(partial)) {
      writeFileSync(partial, '', { flag: 'wx', mode: 0o600 });
      run('UPDATE transfers SET offset=0 WHERE id=?', item.id);
    }
  }
  const app = express();
  app.disable('x-powered-by');
  const tls = options.tls;
  const secureCookies = Boolean(tls || options.secureProxy);
  const server = tls ? httpsServer(tls, app) : httpServer(app);
  const origins = new Set(
    options.origins || [
      'http://localhost:47800',
      'http://127.0.0.1:47800',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
  );
  const allowedHost = (host) => [...origins].some((origin) => new URL(origin).host === host);
  const sockets = new Map();
  const calls = new Map();
  const uploadLocks = new Set();
  const rateLimits = new Map();
  const maxFileSize = options.maxFileSize || 1024 ** 3;
  const maxStorage = options.maxStorage || 5 * 1024 ** 3;
  const bootstrapFile = join(store.directory, 'bootstrap-key');
  let bootstrapKey = null;
  if (!one('SELECT id FROM devices LIMIT 1')) {
    bootstrapKey =
      options.bootstrapKey ||
      (existsSync(bootstrapFile)
        ? readFileSync(bootstrapFile, 'utf8').trim()
        : randomBytes(24).toString('base64url'));
    if (!existsSync(bootstrapFile)) writeFileSync(bootstrapFile, bootstrapKey, { mode: 0o600 });
  }
  const send = (deviceId, payload) => {
    for (const ws of sockets.get(deviceId) || [])
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  const broadcast = () => {
    for (const deviceId of sockets.keys()) send(deviceId, { type: 'state.changed' });
  };
  function endCalls(deviceId) {
    for (const [callId, call] of calls) {
      if (call.from === deviceId || call.to === deviceId) {
        send(call.from, { type: 'screen.stop', callId });
        send(call.to, { type: 'screen.stop', callId });
        calls.delete(callId);
      }
    }
  }
  function revokeSockets(deviceId) {
    endCalls(deviceId);
    for (const ws of sockets.get(deviceId) || []) ws.close(4001, 'Device access revoked');
    sockets.delete(deviceId);
  }
  function authenticate(req) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('omni_session='))
      ?.slice(13);
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : cookie;
    if (!token) return null;
    const device = one(
      `SELECT d.* FROM devices d JOIN sessions s ON s.deviceId=d.id
      WHERE s.hash=? AND s.expiresAt>? AND d.revoked=0`,
      hash(token),
      Date.now(),
    );
    if (!device) return null;
    return publicDevice(device);
  }
  function issueSession(res, device) {
    const token = randomBytes(32).toString('base64url');
    run(
      'INSERT INTO sessions (hash,deviceId,expiresAt) VALUES (?,?,?)',
      hash(token),
      device.id,
      Date.now() + SESSION_AGE,
    );
    res.cookie('omni_session', token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      maxAge: SESSION_AGE,
      path: '/',
    });
    return token;
  }
  const requireOwner = (req) => {
    if (req.device.role !== 'owner') throw fail(403, 'Only the workspace owner can do that.');
  };
  const requireCapability = (req, cap) => {
    if (!req.device.permissions[cap])
      throw fail(403, `This device does not have ${cap} permission.`);
  };
  function validTarget(target, capability) {
    if (!target) return;
    const device = one('SELECT * FROM devices WHERE id=? AND revoked=0', target);
    if (!device || !JSON.parse(device.permissions)[capability])
      throw fail(400, 'The receiving device is unavailable or has not allowed this capability.');
  }
  function accessible(req, item) {
    return (
      item && (item.deviceId === req.device.id || !item.target || item.target === req.device.id)
    );
  }
  function limit(req, key, max, windowMs = 60000) {
    const now = Date.now();
    const address = req.socket.remoteAddress || 'unknown';
    const entryKey = `${key}:${address}`;
    let entry = rateLimits.get(entryKey);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + windowMs };
      rateLimits.set(entryKey, entry);
    }
    if (++entry.count > max)
      throw fail(429, 'Too many attempts. Please wait a minute and try again.');
  }
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (!allowedHost(req.headers.host))
      return next(fail(403, 'Unrecognized host. Add the exact origin to OMNI_ORIGINS.'));
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (req.headers.origin && !origins.has(req.headers.origin))
      return next(fail(403, 'Origin is not allowed.'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-omni-client'] !== '1')
      return next(fail(403, 'Missing request protection header.'));
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0', protocol: 1 }));
  app.get('/api/bootstrap', (req, res) =>
    res.json({
      initialized: Boolean(one('SELECT id FROM devices LIMIT 1')),
      secureTransport: secureCookies,
    }),
  );
  app.post('/api/setup', (req, res) => {
    limit(req, 'setup', 8);
    if (!bootstrapKey || one('SELECT id FROM devices LIMIT 1'))
      throw fail(409, 'This workspace is already set up. Join with a pairing code instead.');
    const data = z
      .object({
        key: z.string(),
        spaceName: nameSchema,
        name: nameSchema,
        platform: platformSchema,
      })
      .parse(req.body);
    if (!timingSafeEqual(Buffer.from(hash(data.key)), Buffer.from(hash(bootstrapKey))))
      throw fail(401, 'The setup key is incorrect.');
    const device = {
      id: id(),
      name: data.name,
      platform: data.platform,
      role: 'owner',
      permissions: { ...defaults, screen: true },
    };
    run(
      'INSERT INTO devices (id,name,platform,role,permissions,createdAt,lastSeen) VALUES (?,?,?,?,?,?,?)',
      device.id,
      device.name,
      device.platform,
      device.role,
      JSON.stringify(device.permissions),
      Date.now(),
      Date.now(),
    );
    run('INSERT INTO settings (key,value) VALUES (?,?)', 'spaceName', data.spaceName);
    run('INSERT INTO settings (key,value) VALUES (?,?)', 'retentionDays', '7');
    const token = issueSession(res, device);
    bootstrapKey = null;
    unlink(bootstrapFile).catch(() => {});
    audit(device.id, 'space.created', `${device.name} created the workspace`);
    res.status(201).json({ device, ...(req.headers['x-omni-cli'] === '1' ? { token } : {}) });
    broadcast();
  });
  app.post('/api/join', (req, res) => {
    limit(req, 'pairing', 10);
    const data = z
      .object({
        code: z.string().trim().min(1).max(32),
        name: nameSchema,
        platform: platformSchema,
      })
      .parse(req.body);
    const invitation = one(
      'SELECT * FROM invitations WHERE hash=? AND expiresAt>?',
      hash(data.code.replace(/[ -]/g, '').toUpperCase()),
      Date.now(),
    );
    if (!invitation) throw fail(401, 'That pairing code is invalid, expired, or already used.');
    const device = {
      id: id(),
      name: data.name,
      platform: data.platform,
      role: invitation.role,
      permissions: JSON.parse(invitation.permissions),
    };
    store.db.exec('BEGIN IMMEDIATE');
    try {
      run(
        'INSERT INTO devices (id,name,platform,role,permissions,createdAt,lastSeen) VALUES (?,?,?,?,?,?,?)',
        device.id,
        device.name,
        device.platform,
        device.role,
        invitation.permissions,
        Date.now(),
        Date.now(),
      );
      run('DELETE FROM invitations WHERE hash=?', invitation.hash);
      store.db.exec('COMMIT');
    } catch (e) {
      store.db.exec('ROLLBACK');
      throw e;
    }
    const token = issueSession(res, device);
    audit(device.id, 'device.paired', `${device.name} joined the workspace`);
    res.status(201).json({ device, ...(req.headers['x-omni-cli'] === '1' ? { token } : {}) });
    broadcast();
  });
  app.post('/api/recover-owner', (req, res) => {
    limit(req, 'owner-recovery', 5);
    const { key } = z.object({ key: z.string().trim().min(1).max(128) }).parse(req.body);
    let owner;
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const recovery = JSON.parse(
        one("SELECT value FROM settings WHERE key='ownerRecovery'")?.value || 'null',
      );
      if (
        !recovery ||
        recovery.expiresAt <= Date.now() ||
        !timingSafeEqual(Buffer.from(hash(key)), Buffer.from(recovery.hash))
      )
        throw fail(401, 'The recovery key is invalid, expired, or already used.');
      owner = one("SELECT * FROM devices WHERE role='owner' AND revoked=0");
      if (!owner) throw fail(409, 'No workspace owner is available to recover.');
      run("DELETE FROM settings WHERE key='ownerRecovery'");
      run('DELETE FROM sessions WHERE deviceId=?', owner.id);
      run('DELETE FROM invitations');
      audit(
        owner.id,
        'owner.recovered',
        'Local administrator recovered owner access and invalidated previous owner sessions',
      );
      const recoveryFile = join(store.directory, 'recovery-key');
      if (
        existsSync(recoveryFile) &&
        hash(readFileSync(recoveryFile, 'utf8').trim()) === recovery.hash
      )
        unlinkSync(recoveryFile);
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }
    revokeSockets(owner.id);
    const device = publicDevice(owner);
    const token = issueSession(res, device);
    res.json({ device, ...(req.headers['x-omni-cli'] === '1' ? { token } : {}) });
    broadcast();
  });
  app.use('/api', (req, res, next) => {
    req.device = authenticate(req);
    if (!req.device) return next(fail(401, 'Join this workspace to continue.'));
    run('UPDATE devices SET lastSeen=? WHERE id=?', Date.now(), req.device.id);
    if (
      ['observer', 'guest'].includes(req.device.role) &&
      !['GET', 'HEAD'].includes(req.method) &&
      !['/presence', '/emergency-stop'].includes(req.path)
    )
      return next(fail(403, 'This device has read-only workspace access.'));
    next();
  });
  const collaboration = installCollaboration({
    app,
    store,
    send,
    sockets,
    broadcast,
    requireCapability,
    endCalls,
  });
  app.get('/api/state', (req, res) => {
    const me = req.device;
    const since =
      Date.now() -
      Number(one("SELECT value FROM settings WHERE key='retentionDays'")?.value || 7) * 86400000;
    run('DELETE FROM clips WHERE pinned=0 AND createdAt<?', since);
    const scoped = (rows) => rows.filter((row) => accessible(req, row));
    res.json({
      me,
      focusMode: one('SELECT status FROM presence WHERE deviceId=?', me.id)?.status === 'focus',
      space: {
        name: one("SELECT value FROM settings WHERE key='spaceName'")?.value || 'My space',
        retentionDays: Number(
          one("SELECT value FROM settings WHERE key='retentionDays'")?.value || 7,
        ),
      },
      devices: all('SELECT * FROM devices WHERE revoked=0 ORDER BY createdAt').map((d) => ({
        ...publicDevice(d),
        online:
          Boolean(sockets.get(d.id)?.size) || Date.now() - d.lastSeen < 30000 || d.id === me.id,
      })),
      clips: me.permissions.clipboard
        ? scoped(all('SELECT * FROM clips ORDER BY pinned DESC,createdAt DESC LIMIT 300'))
        : [],
      transfers: me.permissions.files
        ? scoped(all('SELECT * FROM transfers ORDER BY createdAt DESC LIMIT 300'))
        : [],
      messages: me.permissions.chat
        ? all(
            'SELECT * FROM (SELECT * FROM messages ORDER BY createdAt DESC LIMIT 200) ORDER BY createdAt',
          )
        : [],
      notes: me.permissions.chat ? all('SELECT * FROM notes ORDER BY createdAt DESC LIMIT 50') : [],
      notifications: me.permissions.notifications
        ? all(
            'SELECT * FROM notifications WHERE target=? AND dismissed=0 ORDER BY createdAt DESC LIMIT 50',
            me.id,
          )
        : [],
      activity: all('SELECT * FROM audit ORDER BY seq DESC LIMIT 60').filter(
        (e) => me.role === 'owner' || e.deviceId === me.id,
      ),
      limits: {
        chunkSize: CHUNK_SIZE,
        maxFileSize,
        maxStorage,
        usedStorage: one(
          "SELECT COALESCE(SUM(size),0) AS size FROM transfers WHERE status!='cancelled'",
        ).size,
      },
      transport: { secure: secureCookies, mode: 'Local service', endToEndEncrypted: false },
    });
  });
  app.post('/api/invitations', (req, res) => {
    requireOwner(req);
    limit(req, 'invitations', 15);
    const data = z
      .object({
        role: z.enum(['member', 'guest', 'observer']).default('member'),
        permissions: permissionsSchema.optional(),
      })
      .parse(req.body);
    const code = randomBytes(5).toString('hex').toUpperCase();
    const permissions =
      data.permissions ||
      (['guest', 'observer'].includes(data.role)
        ? { ...defaults, clipboard: false, notifications: false, screen: true }
        : defaults);
    const expiresAt = Date.now() + 5 * 60000;
    run(
      'INSERT INTO invitations (hash,role,permissions,expiresAt,createdBy) VALUES (?,?,?,?,?)',
      hash(code),
      data.role,
      JSON.stringify(permissions),
      expiresAt,
      req.device.id,
    );
    audit(req.device.id, 'pairing.created', 'Created a single-use pairing invitation');
    res.status(201).json({ code, expiresAt, permissions });
    broadcast();
  });
  app.patch('/api/devices/:id', (req, res) => {
    const data = z
      .object({ name: nameSchema.optional(), permissions: permissionsSchema.optional() })
      .parse(req.body);
    if (req.params.id !== req.device.id) requireOwner(req);
    if (data.permissions) requireOwner(req);
    const device = one('SELECT * FROM devices WHERE id=? AND revoked=0', req.params.id);
    if (!device) throw fail(404, 'Device not found.');
    if (device.role === 'owner' && data.permissions)
      throw fail(400, 'The owner retains workspace capabilities.');
    run(
      'UPDATE devices SET name=?, permissions=? WHERE id=?',
      data.name || device.name,
      data.permissions ? JSON.stringify(data.permissions) : device.permissions,
      device.id,
    );
    if (data.permissions && !data.permissions.screen) endCalls(device.id);
    audit(req.device.id, 'device.updated', `Updated ${data.name || device.name}`);
    res.json({ ok: true });
    broadcast();
  });
  app.delete('/api/devices/:id', (req, res) => {
    requireOwner(req);
    const device = one('SELECT * FROM devices WHERE id=? AND revoked=0', req.params.id);
    if (!device) throw fail(404, 'Device not found.');
    if (device.role === 'owner') throw fail(400, 'The owner device cannot be revoked.');
    run('UPDATE devices SET revoked=1 WHERE id=?', device.id);
    run('DELETE FROM sessions WHERE deviceId=?', device.id);
    revokeSockets(device.id);
    audit(req.device.id, 'device.revoked', `Revoked access for ${device.name}`);
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/lockdown', (req, res) => {
    requireOwner(req);
    for (const device of all("SELECT id FROM devices WHERE role!='owner' AND revoked=0")) {
      run('UPDATE devices SET revoked=1 WHERE id=?', device.id);
      run('DELETE FROM sessions WHERE deviceId=?', device.id);
      revokeSockets(device.id);
    }
    run('DELETE FROM invitations');
    endCalls(req.device.id);
    audit(
      req.device.id,
      'space.lockdown',
      'Lockdown revoked all other devices and pending invitations',
    );
    res.json({ ok: true });
    broadcast();
  });
  app.patch('/api/settings', (req, res) => {
    requireOwner(req);
    const data = z
      .object({ name: nameSchema, retentionDays: z.number().int().min(1).max(30) })
      .parse(req.body);
    run("UPDATE settings SET value=? WHERE key='spaceName'", data.name);
    run("UPDATE settings SET value=? WHERE key='retentionDays'", String(data.retentionDays));
    audit(req.device.id, 'space.updated', 'Updated workspace settings');
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/clipboard', (req, res) => {
    requireCapability(req, 'clipboard');
    limit(req, 'clipboard', 60);
    const data = z
      .object({ text: z.string().trim().min(1).max(32000), target: targetSchema })
      .parse(req.body);
    validTarget(data.target, 'clipboard');
    const clipId = id();
    run(
      'INSERT INTO clips (id,deviceId,text,target,createdAt) VALUES (?,?,?,?,?)',
      clipId,
      req.device.id,
      data.text,
      data.target || null,
      Date.now(),
    );
    run(
      'DELETE FROM clips WHERE pinned=0 AND id NOT IN (SELECT id FROM clips ORDER BY createdAt DESC LIMIT 300)',
    );
    audit(req.device.id, 'clipboard.shared', `${req.device.name} shared a clipboard item`);
    res.status(201).json({ id: clipId });
    broadcast();
  });
  app.patch('/api/clipboard/:id', (req, res) => {
    requireCapability(req, 'clipboard');
    const data = z.object({ pinned: z.boolean() }).parse(req.body);
    const item = one('SELECT * FROM clips WHERE id=?', req.params.id);
    if (!accessible(req, item)) throw fail(404, 'Clipboard item not found.');
    if (item.deviceId !== req.device.id && req.device.role !== 'owner')
      throw fail(403, 'Only the sender or owner can pin this item.');
    if (data.pinned && one('SELECT COUNT(*) AS count FROM clips WHERE pinned=1').count >= 50)
      throw fail(400, 'Unpin an item first. The shelf holds up to 50 pinned items.');
    run('UPDATE clips SET pinned=? WHERE id=?', Number(data.pinned), item.id);
    res.json({ ok: true });
    broadcast();
  });
  app.delete('/api/clipboard/:id', (req, res) => {
    requireCapability(req, 'clipboard');
    const item = one('SELECT * FROM clips WHERE id=?', req.params.id);
    if (!accessible(req, item)) throw fail(404, 'Clipboard item not found.');
    if (item.deviceId !== req.device.id && req.device.role !== 'owner')
      throw fail(403, 'Only the sender or owner can delete this item.');
    run('DELETE FROM clips WHERE id=?', item.id);
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/transfers', (req, res) => {
    requireCapability(req, 'files');
    limit(req, 'file-offer', 60);
    const data = z
      .object({
        name: z
          .string()
          .min(1)
          .max(255)
          .refine((v) => !/[\/\\\x00-\x1f]/.test(v) && v !== '.' && v !== '..', 'Invalid filename'),
        size: z.number().int().min(0).max(maxFileSize),
        sha256: hex,
        target: targetSchema,
      })
      .parse(req.body);
    validTarget(data.target, 'files');
    const existing = one(
      "SELECT * FROM transfers WHERE deviceId=? AND name=? AND size=? AND sha256=? AND target IS ? AND status='uploading'",
      req.device.id,
      data.name,
      data.size,
      data.sha256,
      data.target || null,
    );
    if (existing) return res.json(existing);
    const used = one(
      "SELECT COALESCE(SUM(size),0) AS size FROM transfers WHERE status!='cancelled'",
    ).size;
    if (used + data.size > maxStorage)
      throw fail(413, 'Workspace storage is full. Delete old transfers to free space.');
    const transfer = {
      id: id(),
      deviceId: req.device.id,
      target: data.target || null,
      name: data.name,
      size: data.size,
      sha256: data.sha256,
      offset: 0,
      status: 'uploading',
      createdAt: Date.now(),
    };
    run(
      'INSERT INTO transfers (id,deviceId,target,name,size,sha256,status,createdAt) VALUES (?,?,?,?,?,?,?,?)',
      transfer.id,
      transfer.deviceId,
      transfer.target,
      transfer.name,
      transfer.size,
      transfer.sha256,
      transfer.status,
      transfer.createdAt,
    );
    writeFileSync(join(store.directory, 'files', `${transfer.id}.part`), '', {
      flag: 'wx',
      mode: 0o600,
    });
    audit(req.device.id, 'file.offered', `${req.device.name} started a file transfer`);
    res.status(201).json(transfer);
    broadcast();
  });
  app.put(
    '/api/transfers/:id/chunk',
    express.raw({ type: 'application/octet-stream', limit: CHUNK_SIZE }),
    async (req, res) => {
      requireCapability(req, 'files');
      const item = one(
        'SELECT * FROM transfers WHERE id=? AND deviceId=?',
        req.params.id,
        req.device.id,
      );
      if (!item) throw fail(404, 'Transfer not found.');
      if (item.status !== 'uploading') throw fail(409, 'Transfer is no longer accepting chunks.');
      if (uploadLocks.has(item.id)) throw fail(409, 'A chunk is already being written.');
      const offset = Number(req.headers['x-offset']);
      if (!Number.isSafeInteger(offset) || offset !== item.offset)
        throw fail(409, `Resume at offset ${item.offset}.`);
      if (
        !Buffer.isBuffer(req.body) ||
        !req.body.length ||
        req.body.length > CHUNK_SIZE ||
        offset + req.body.length > item.size
      )
        throw fail(400, 'Invalid chunk length.');
      if (hash(req.body) !== req.headers['x-chunk-sha256'])
        throw fail(422, 'Chunk checksum did not match.');
      uploadLocks.add(item.id);
      let file;
      const nextOffset = offset + req.body.length;
      try {
        file = await open(join(store.directory, 'files', `${item.id}.part`), 'r+');
        let written = 0;
        while (written < req.body.length) {
          const { bytesWritten } = await file.write(
            req.body,
            written,
            req.body.length - written,
            offset + written,
          );
          if (!bytesWritten) throw fail(500, 'Unable to save the file chunk.');
          written += bytesWritten;
        }
        await file.sync();
        // Revocation/cancellation can happen while the disk write is pending.
        if (
          !authenticate(req)?.permissions.files ||
          one('SELECT status FROM transfers WHERE id=?', item.id)?.status !== 'uploading'
        )
          throw fail(409, 'Transfer access changed.');
        run('UPDATE transfers SET offset=? WHERE id=?', nextOffset, item.id);
      } finally {
        try {
          await file?.close();
        } finally {
          uploadLocks.delete(item.id);
        }
      }
      // Acknowledgment means the next chunk or completion can begin immediately.
      res.json({ offset: nextOffset });
      broadcast();
    },
  );
  app.post('/api/transfers/:id/complete', async (req, res) => {
    requireCapability(req, 'files');
    const item = one(
      'SELECT * FROM transfers WHERE id=? AND deviceId=?',
      req.params.id,
      req.device.id,
    );
    if (!item) throw fail(404, 'Transfer not found.');
    if (item.status === 'ready') return res.json(item);
    if (item.status !== 'uploading' || item.offset !== item.size || uploadLocks.has(item.id))
      throw fail(409, 'Upload every chunk before completing this transfer.');
    uploadLocks.add(item.id);
    try {
      const path = join(store.directory, 'files', `${item.id}.part`);
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      if ((await stat(path)).size !== item.size || digest.digest('hex') !== item.sha256)
        throw fail(422, 'Whole-file verification failed. Cancel and upload the file again.');
      const current = authenticate(req);
      if (
        !current?.permissions.files ||
        one('SELECT status FROM transfers WHERE id=?', item.id)?.status !== 'uploading'
      )
        throw fail(409, 'Transfer access changed.');
      await rename(path, join(store.directory, 'files', item.id));
      run("UPDATE transfers SET status='ready',completedAt=? WHERE id=?", Date.now(), item.id);
      audit(
        req.device.id,
        'file.completed',
        `${req.device.name} completed a verified file transfer`,
      );
      res.json({ ...item, status: 'ready' });
      broadcast();
    } finally {
      uploadLocks.delete(item.id);
    }
  });
  app.get('/api/transfers/:id/download', (req, res) => {
    requireCapability(req, 'files');
    const item = one('SELECT * FROM transfers WHERE id=?', req.params.id);
    if (!accessible(req, item) || item.status !== 'ready')
      throw fail(404, 'File not found or not available to this device.');
    res.set('X-File-SHA256', item.sha256);
    res.download(join(store.directory, 'files', item.id), item.name);
  });
  app.delete('/api/transfers/:id', async (req, res) => {
    requireCapability(req, 'files');
    const item = one('SELECT * FROM transfers WHERE id=?', req.params.id);
    if (!item || !accessible(req, item)) throw fail(404, 'Transfer not found.');
    if (item.deviceId !== req.device.id && req.device.role !== 'owner')
      throw fail(403, 'Only the sender or owner can delete this transfer.');
    if (uploadLocks.has(item.id))
      throw fail(409, 'A chunk is being saved. Pause the upload and try again.');
    run("UPDATE transfers SET status='cancelled' WHERE id=?", item.id);
    for (const suffix of ['', '.part'])
      await unlink(join(store.directory, 'files', item.id + suffix)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    run('DELETE FROM transfers WHERE id=?', item.id);
    audit(req.device.id, 'file.deleted', 'Deleted a file transfer');
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/messages', (req, res) => {
    requireCapability(req, 'chat');
    limit(req, 'chat', 60);
    const data = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const messageId = id();
    run(
      'INSERT INTO messages (id,deviceId,text,createdAt) VALUES (?,?,?,?)',
      messageId,
      req.device.id,
      data.text,
      Date.now(),
    );
    run(
      'DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY createdAt DESC LIMIT 200)',
    );
    res.status(201).json({ id: messageId });
    broadcast();
  });
  app.post('/api/notes', (req, res) => {
    requireCapability(req, 'chat');
    const data = z
      .object({
        text: z.string().trim().min(1).max(1000),
        color: z.enum(['sage', 'peach', 'lavender']).default('sage'),
      })
      .parse(req.body);
    if (one('SELECT COUNT(*) AS count FROM notes').count >= 50)
      throw fail(400, 'The board is full. Remove an old note first.');
    const noteId = id();
    run(
      'INSERT INTO notes (id,deviceId,text,color,createdAt) VALUES (?,?,?,?,?)',
      noteId,
      req.device.id,
      data.text,
      data.color,
      Date.now(),
    );
    res.status(201).json({ id: noteId });
    broadcast();
  });
  app.delete('/api/notes/:id', (req, res) => {
    requireCapability(req, 'chat');
    const note = one('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!note) throw fail(404, 'Note not found.');
    if (note.deviceId !== req.device.id && req.device.role !== 'owner')
      throw fail(403, 'Only the author or owner can remove this note.');
    run('DELETE FROM notes WHERE id=?', note.id);
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/notifications', (req, res) => {
    requireCapability(req, 'notifications');
    limit(req, 'notify', 30);
    const data = z
      .object({
        target: z.string().uuid(),
        title: z.string().trim().min(1).max(100),
        body: z.string().max(1000),
      })
      .parse(req.body);
    validTarget(data.target, 'notifications');
    const notificationId = id();
    run(
      'INSERT INTO notifications (id,deviceId,target,title,body,createdAt) VALUES (?,?,?,?,?,?)',
      notificationId,
      req.device.id,
      data.target,
      data.title,
      data.body,
      Date.now(),
    );
    run(
      'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY createdAt DESC LIMIT 500)',
    );
    res.status(201).json({ id: notificationId });
    broadcast();
  });
  app.delete('/api/notifications/:id', (req, res) => {
    run(
      'UPDATE notifications SET dismissed=1 WHERE id=? AND target=?',
      req.params.id,
      req.device.id,
    );
    res.json({ ok: true });
    broadcast();
  });
  app.get('/api/audit/verify', (req, res) => {
    requireOwner(req);
    let previousHash = '0'.repeat(64);
    let count = 0;
    for (const row of all('SELECT * FROM audit ORDER BY seq')) {
      const { id, deviceId, action, detail, createdAt } = row;
      const digest = hash(
        JSON.stringify({ id, deviceId, action, detail, createdAt, previousHash }),
      );
      if (row.previousHash !== previousHash || row.hash !== digest)
        return res.json({ valid: false, count, failedAt: row.seq });
      previousHash = row.hash;
      count++;
    }
    res.json({ valid: true, count });
  });
  app.use('/api', (req, res, next) => next(fail(404, 'API endpoint not found.')));
  const dist = resolve(options.distDir || 'dist');
  app.use(express.static(dist, { index: false, maxAge: 0 }));
  app.get('/{*path}', (req, res) => {
    if (existsSync(join(dist, 'index.html'))) res.sendFile(join(dist, 'index.html'));
    else
      res
        .status(503)
        .type('text')
        .send('Build the web app with npm run build, or use npm run dev.');
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const validation = err instanceof z.ZodError;
    const status = validation ? 400 : err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500 && options.onError) options.onError(err);
    res.status(status).json({
      error: validation
        ? err.issues.map((i) => `${i.path.join('.') || 'Request'}: ${i.message}`).join('; ')
        : status >= 500
          ? 'The server could not complete this request.'
          : err.message,
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const device = authenticate(req);
    if (
      req.url !== '/events' ||
      !allowedHost(req.headers.host) ||
      !origins.has(req.headers.origin) ||
      !device
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.deviceId = device.id;
      ws.alive = true;
      ws.authRequest = req;
      if (!sockets.has(device.id)) sockets.set(device.id, new Set());
      sockets.get(device.id).add(ws);
      broadcast();
      ws.on('pong', () => {
        ws.alive = true;
      });
      ws.on('message', (raw) => {
        try {
          const current = authenticate(req);
          if (!current) return ws.close(4001, 'Session expired');
          limit(req, 'socket:' + current.id, 240);
          const message = JSON.parse(raw.toString());
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', ts: message.ts }));
            return;
          }
          if (collaboration.handleMessage(req, ws, current, message)) return;
          if (!current.permissions.screen)
            throw fail(403, 'Screen-sharing permission is required.');
          if (message.type === 'screen.request') {
            if (['guest', 'observer'].includes(current.role))
              throw fail(403, 'Observers can view invited screens, but cannot present.');
            const target = z.string().uuid().parse(message.to);
            if (target === current.id) throw fail(400, 'Choose another device.');
            validTarget(target, 'screen');
            if (!sockets.get(target)?.size) throw fail(409, 'That device is offline.');
            if (
              [...calls.values()].some(
                (call) =>
                  [call.from, call.to].includes(current.id) ||
                  [call.from, call.to].includes(target),
              )
            )
              throw fail(409, 'One of these devices is already in a screen session.');
            const callId = id();
            calls.set(callId, {
              from: current.id,
              to: target,
              accepted: false,
              createdAt: Date.now(),
            });
            send(target, { type: 'screen.request', callId, from: current.id });
            send(current.id, { type: 'screen.pending', callId, to: target });
            return;
          }
          const call = calls.get(message.callId);
          if (!call || ![call.from, call.to].includes(current.id))
            throw fail(403, 'Screen session not found.');
          const peer = call.from === current.id ? call.to : call.from;
          if (message.type === 'screen.accept') {
            if (call.to !== current.id || call.accepted)
              throw fail(403, 'Only the invited viewer can accept.');
            call.accepted = true;
            send(call.from, { type: 'screen.accept', callId: message.callId, from: current.id });
            audit(
              current.id,
              'screen.accepted',
              `${current.name} accepted a screen-sharing session`,
            );
          } else if (message.type === 'screen.stop') {
            calls.delete(message.callId);
            send(peer, { type: 'screen.stop', callId: message.callId });
          } else if (message.type === 'screen.signal' && call.accepted) {
            const signal = z
              .object({
                description: z
                  .object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(48000) })
                  .optional(),
                candidate: z.record(z.string(), z.unknown()).optional(),
              })
              .parse(message.signal);
            send(peer, { type: 'screen.signal', callId: message.callId, from: current.id, signal });
          } else throw fail(400, 'Unsupported screen message.');
        } catch (e) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: e.status ? e.message : 'Invalid realtime message.',
            }),
          );
        }
      });
      ws.on('close', () => {
        const set = sockets.get(device.id);
        set?.delete(ws);
        if (!set?.size) {
          sockets.delete(device.id);
          endCalls(device.id);
        }
        run('UPDATE devices SET lastSeen=? WHERE id=?', Date.now(), device.id);
        broadcast();
      });
      ws.on('error', () => {});
    });
  });
  const heartbeat = setInterval(() => {
    for (const clients of sockets.values())
      for (const ws of clients) {
        if (!authenticate(ws.authRequest)) {
          endCalls(ws.deviceId);
          ws.close(4001, 'Session expired');
        } else if (!ws.alive) ws.terminate();
        else {
          ws.alive = false;
          ws.ping();
        }
      }
    for (const [key, value] of rateLimits) if (value.until < Date.now()) rateLimits.delete(key);
    for (const [callId, call] of calls)
      if (!call.accepted && call.createdAt < Date.now() - 60000) {
        send(call.from, { type: 'screen.stop', callId });
        send(call.to, { type: 'screen.stop', callId });
        calls.delete(callId);
      }
    run('DELETE FROM sessions WHERE expiresAt<?', Date.now());
    run('DELETE FROM invitations WHERE expiresAt<?', Date.now());
  }, 25000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const clients of sockets.values()) for (const ws of clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    collaboration.close();
    store.db.close();
  }
  return { app, server, store, close, origins, bootstrapFile };
}
