import * as Y from 'yjs';
import { z } from 'zod';
import { id } from './store.js';

export function installCollaboration({
  app,
  store,
  send,
  sockets,
  broadcast,
  requireCapability,
  endCalls,
}) {
  const { one, all, run, audit } = store;
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, text TEXT NOT NULL, deviceId TEXT NOT NULL, assignee TEXT, due TEXT, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS file_requests (id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS presence (deviceId TEXT PRIMARY KEY, status TEXT NOT NULL);
  `);
  let doc = new Y.Doc();
  const saved = one("SELECT value FROM settings WHERE key='scratchpad'");
  if (saved) Y.applyUpdate(doc, Buffer.from(saved.value, 'base64'));
  const fault = (status, message) => Object.assign(new Error(message), { status });
  function canWrite(device) {
    return device.permissions.chat && !['observer', 'guest'].includes(device.role);
  }
  function relay(update) {
    for (const deviceId of sockets.keys()) {
      const device = one('SELECT permissions,revoked FROM devices WHERE id=?', deviceId);
      if (device && !device.revoked && JSON.parse(device.permissions).chat)
        send(deviceId, { type: 'scratchpad.update', update });
    }
  }
  app.get('/api/collaboration', (req, res) => {
    res.json({
      scratchpad: req.device.permissions.chat
        ? Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
        : null,
      tasks: req.device.permissions.chat
        ? all('SELECT * FROM tasks ORDER BY createdAt DESC LIMIT 200')
        : [],
      requests: req.device.permissions.files
        ? all(
            'SELECT * FROM file_requests WHERE deviceId=? OR target=? ORDER BY createdAt DESC LIMIT 100',
            req.device.id,
            req.device.id,
          )
        : [],
      presence: all('SELECT * FROM presence'),
    });
  });
  app.patch('/api/presence', (req, res) => {
    const data = z
      .object({ status: z.enum(['available', 'busy', 'focus', 'away']) })
      .parse(req.body);
    run(
      'INSERT INTO presence (deviceId,status) VALUES (?,?) ON CONFLICT(deviceId) DO UPDATE SET status=excluded.status',
      req.device.id,
      data.status,
    );
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/tasks', (req, res) => {
    requireCapability(req, 'chat');
    const data = z
      .object({
        text: z.string().trim().min(1).max(300),
        assignee: z.string().uuid().nullable().default(null),
        due: z.string().date().nullable().default(null),
      })
      .parse(req.body);
    if (data.assignee && !one('SELECT id FROM devices WHERE id=? AND revoked=0', data.assignee))
      throw fault(400, 'Assignee is no longer in this workspace.');
    if (one('SELECT COUNT(*) AS count FROM tasks').count >= 200)
      throw fault(400, 'Remove completed tasks before adding more.');
    const taskId = id();
    run(
      "INSERT INTO tasks (id,text,deviceId,assignee,due,status,createdAt) VALUES (?,?,?,?,?,'todo',?)",
      taskId,
      data.text,
      req.device.id,
      data.assignee,
      data.due,
      Date.now(),
    );
    audit(req.device.id, 'task.created', `${req.device.name} added a task`);
    res.status(201).json({ id: taskId });
    broadcast();
  });
  app.patch('/api/tasks/:id', (req, res) => {
    requireCapability(req, 'chat');
    const data = z
      .object({ status: z.enum(['todo', 'doing', 'done']), version: z.number().int().min(1) })
      .parse(req.body);
    const changed = run(
      'UPDATE tasks SET status=?,version=version+1 WHERE id=? AND version=?',
      data.status,
      req.params.id,
      data.version,
    );
    if (!changed.changes)
      throw fault(409, 'This task changed on another device. Refresh and try again.');
    res.json({ ok: true });
    broadcast();
  });
  app.delete('/api/tasks/:id', (req, res) => {
    requireCapability(req, 'chat');
    const task = one('SELECT * FROM tasks WHERE id=?', req.params.id);
    if (!task) throw fault(404, 'Task not found.');
    if (task.deviceId !== req.device.id && req.device.role !== 'owner')
      throw fault(403, 'Only the task creator or owner can delete it.');
    run('DELETE FROM tasks WHERE id=?', task.id);
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/file-requests', (req, res) => {
    requireCapability(req, 'files');
    const data = z
      .object({ target: z.string().uuid(), text: z.string().trim().min(1).max(500) })
      .parse(req.body);
    const recipient = one('SELECT * FROM devices WHERE id=? AND revoked=0', data.target);
    if (
      !recipient ||
      !JSON.parse(recipient.permissions).files ||
      ['guest', 'observer'].includes(recipient.role)
    )
      throw fault(400, 'Choose a device that can send files.');
    if (
      one(
        "SELECT COUNT(*) AS count FROM file_requests WHERE status='pending' AND deviceId=?",
        req.device.id,
      ).count >= 20
    )
      throw fault(400, 'Resolve earlier requests before sending more.');
    const requestId = id();
    run(
      "INSERT INTO file_requests (id,deviceId,target,text,status,createdAt) VALUES (?,?,?,?,'pending',?)",
      requestId,
      req.device.id,
      data.target,
      data.text,
      Date.now(),
    );
    audit(req.device.id, 'file.requested', `${req.device.name} requested a file`);
    res.status(201).json({ id: requestId });
    broadcast();
  });
  app.patch('/api/file-requests/:id', (req, res) => {
    requireCapability(req, 'files');
    const data = z.object({ status: z.enum(['declined', 'fulfilled']) }).parse(req.body);
    const changed = run(
      "UPDATE file_requests SET status=? WHERE id=? AND target=? AND status='pending'",
      data.status,
      req.params.id,
      req.device.id,
    );
    if (!changed.changes) throw fault(404, 'Request not found or already resolved.');
    res.json({ ok: true });
    broadcast();
  });
  app.post('/api/emergency-stop', (req, res) => {
    endCalls(req.device.id);
    audit(req.device.id, 'screen.stopped', `${req.device.name} ended its screen sessions`);
    res.json({ ok: true });
    broadcast();
  });
  app.get('/api/audit/export', (req, res) => {
    if (req.device.role !== 'owner')
      throw fault(403, 'Only the owner can export the full audit log.');
    res.attachment('omnisync-activity.json').json(all('SELECT * FROM audit ORDER BY seq'));
  });
  function handleMessage(req, ws, device, message) {
    if (message.type !== 'scratchpad.update') return false;
    if (!canWrite(device)) throw fault(403, 'This device has read-only access to the scratchpad.');
    const data = z
      .object({
        update: z
          .string()
          .max(60000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .parse(message);
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
      Y.applyUpdate(candidate, Buffer.from(data.update, 'base64'));
      const encoded = Y.encodeStateAsUpdate(candidate);
      if (encoded.length > 44000 || candidate.getText('scratchpad').length > 16000)
        throw fault(
          413,
          'The shared scratchpad is full. Start a new note on the board for more space.',
        );
      const snapshot = Buffer.from(encoded).toString('base64');
      run(
        "INSERT INTO settings (key,value) VALUES ('scratchpad',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        snapshot,
      );
      Y.applyUpdate(doc, Buffer.from(data.update, 'base64'));
      relay(snapshot);
    } finally {
      candidate.destroy();
    }
    return true;
  }
  return { handleMessage, close: () => doc.destroy() };
}
