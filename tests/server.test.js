import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { request as httpRequest } from 'node:http';
import { createOmniServer } from '../server/app.js';
import { hash } from '../server/store.js';
import { createOwnerRecovery } from '../server/recovery.js';

const resources = [];
after(async () => {
  for (const r of resources.reverse()) {
    await r.instance.close();
    await rm(r.directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'omni-test-'));
  const instance = createOmniServer({
    dataDir: directory,
    bootstrapKey: 'test-only-bootstrap',
    origins: ['http://localhost'],
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  instance.origins.add(base);
  const resource = { instance, directory };
  resources.push(resource);
  async function request(path, method = 'GET', body, token, extraHeaders = {}) {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        Host: 'localhost',
        Origin: 'http://localhost',
        'X-Omni-Client': '1',
        'X-Omni-Cli': '1',
        'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  }
  const setup = await request('/setup', 'POST', {
    key: 'test-only-bootstrap',
    name: 'Owner Mac',
    spaceName: 'Test space',
    platform: 'macOS',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.data));
  const owner = setup.data;
  async function pair(permissions) {
    const invitation = await request(
      '/invitations',
      'POST',
      permissions ? { permissions } : {},
      owner.token,
    );
    assert.equal(invitation.status, 201);
    const joined = await request('/join', 'POST', {
      code: invitation.data.code,
      name: 'Android phone',
      platform: 'Android',
    });
    assert.equal(joined.status, 201);
    return { ...joined.data, code: invitation.data.code };
  }
  return { ...resource, base, request, owner, pair };
}

test('local owner recovery is private, expiring, single-use, and rotates owner access without deleting data', async () => {
  const f = await fixture();
  const member = await f.pair();
  await f.request('/clipboard', 'POST', { text: 'Preserve this owner content' }, f.owner.token);
  const invitation = await f.request('/invitations', 'POST', {}, f.owner.token);
  const first = createOwnerRecovery(f.directory);
  const expiredKey = (await readFile(first.path, 'utf8')).trim();
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  const stored = JSON.parse(
    f.instance.store.one("SELECT value FROM settings WHERE key='ownerRecovery'").value,
  );
  assert.equal(stored.hash, hash(expiredKey));
  stored.expiresAt = 0;
  f.instance.store.run(
    "UPDATE settings SET value=? WHERE key='ownerRecovery'",
    JSON.stringify(stored),
  );
  assert.equal((await f.request('/recover-owner', 'POST', { key: expiredKey })).status, 401);
  const recovery = createOwnerRecovery(f.directory);
  const key = (await readFile(recovery.path, 'utf8')).trim();
  assert.equal((await f.request('/recover-owner', 'POST', { key: 'wrong-key' })).status, 401);
  assert.equal((await f.request('/state', 'GET', undefined, f.owner.token)).status, 200);
  const restored = await f.request('/recover-owner', 'POST', { key });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.device.id, f.owner.device.id);
  assert.notEqual(restored.data.token, f.owner.token);
  assert.equal((await f.request('/state', 'GET', undefined, f.owner.token)).status, 401);
  const state = await f.request('/state', 'GET', undefined, restored.data.token);
  assert.equal(state.data.me.role, 'owner');
  assert.equal(state.data.clips[0].text, 'Preserve this owner content');
  assert.equal((await f.request('/state', 'GET', undefined, member.token)).status, 200);
  assert.equal(
    (
      await f.request('/join', 'POST', {
        code: invitation.data.code,
        name: 'Stale invitation',
        platform: 'Browser',
      })
    ).status,
    401,
  );
  assert.equal((await f.request('/recover-owner', 'POST', { key })).status, 401);
  await assert.rejects(readFile(recovery.path), { code: 'ENOENT' });
  assert.equal(
    (await f.request('/audit/verify', 'GET', undefined, restored.data.token)).data.valid,
    true,
  );
});

test('bootstrap is single-use, authenticated, and removes its local key', async () => {
  const f = await fixture();
  assert.equal((await f.request('/bootstrap')).data.initialized, true);
  assert.equal(
    (
      await f.request('/setup', 'POST', {
        key: 'test-only-bootstrap',
        name: 'Other',
        spaceName: 'X',
        platform: 'Browser',
      })
    ).status,
    409,
  );
  assert.equal((await f.request('/state')).status, 401);
  assert.equal(
    (await f.request('/state', 'GET', undefined, f.owner.token)).data.me.name,
    'Owner Mac',
  );
  assert.equal(f.instance.store.one('SELECT hash FROM sessions').hash, hash(f.owner.token));
});
test('single-use invitations pair clients, expire, and default screen access to off', async () => {
  const f = await fixture();
  const member = await f.pair();
  assert.equal(member.device.permissions.screen, false);
  assert.equal(
    (await f.request('/join', 'POST', { code: member.code, name: 'Intruder', platform: 'Browser' }))
      .status,
    401,
  );
  const invite = await f.request('/invitations', 'POST', {}, f.owner.token);
  f.instance.store.run('UPDATE invitations SET expiresAt=0');
  assert.equal(
    (
      await f.request('/join', 'POST', {
        code: invite.data.code,
        name: 'Expired',
        platform: 'Browser',
      })
    ).status,
    401,
  );
  assert.equal((await f.request('/invitations', 'POST', {}, member.token)).status, 403);
});
test('text exchange persists, target privacy is enforced, and permissions revoke immediately', async () => {
  const f = await fixture();
  const member = await f.pair();
  const outsider = await f.pair();
  const clip = await f.request(
    '/clipboard',
    'POST',
    { text: 'Cross-device clipboard ✓', target: member.device.id },
    f.owner.token,
  );
  assert.equal(clip.status, 201);
  assert.equal(
    (await f.request('/state', 'GET', undefined, member.token)).data.clips[0].text,
    'Cross-device clipboard ✓',
  );
  assert.equal((await f.request('/state', 'GET', undefined, outsider.token)).data.clips.length, 0);
  assert.equal(
    (await f.request(`/clipboard/${clip.data.id}`, 'PATCH', { pinned: true }, outsider.token))
      .status,
    404,
  );
  assert.equal(
    (await f.request(`/clipboard/${clip.data.id}`, 'DELETE', undefined, member.token)).status,
    403,
  );
  await f.request(
    `/devices/${member.device.id}`,
    'PATCH',
    { permissions: { ...member.device.permissions, clipboard: false } },
    f.owner.token,
  );
  assert.equal(
    (await f.request('/clipboard', 'POST', { text: 'Blocked' }, member.token)).status,
    403,
  );
  assert.equal((await f.request('/state', 'GET', undefined, member.token)).data.clips.length, 0);
});
test('clipboard retention clears old unpinned items but preserves pinned content', async () => {
  const f = await fixture();
  const a = await f.request('/clipboard', 'POST', { text: 'Old' }, f.owner.token);
  const b = await f.request('/clipboard', 'POST', { text: 'Keep me' }, f.owner.token);
  await f.request(`/clipboard/${b.data.id}`, 'PATCH', { pinned: true }, f.owner.token);
  f.instance.store.run('UPDATE clips SET createdAt=0');
  const state = (await f.request('/state', 'GET', undefined, f.owner.token)).data;
  assert.deepEqual(
    state.clips.map((c) => c.id),
    [b.data.id],
  );
});
test('uploads resume, reject bad chunks and offsets, verify whole-file hashes, and enforce downloads', async () => {
  const f = await fixture();
  const receiver = await f.pair();
  const outsider = await f.pair();
  const contents = Buffer.from('A real file transferred in two chunks, including unicode: café!');
  const offer = {
    name: 'hello.txt',
    size: contents.length,
    sha256: hash(contents),
    target: receiver.device.id,
  };
  const t = (await f.request('/transfers', 'POST', offer, f.owner.token)).data;
  const chunk = contents.subarray(0, 20);
  assert.equal(
    (
      await f.request(`/transfers/${t.id}/chunk`, 'PUT', chunk, f.owner.token, {
        'X-Offset': '0',
        'X-Chunk-SHA256': 'bad',
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await f.request(`/transfers/${t.id}/chunk`, 'PUT', chunk, f.owner.token, {
        'X-Offset': '3',
        'X-Chunk-SHA256': hash(chunk),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(`/transfers/${t.id}/chunk`, 'PUT', chunk, outsider.token, {
        'X-Offset': '0',
        'X-Chunk-SHA256': hash(chunk),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(`/transfers/${t.id}/chunk`, 'PUT', chunk, f.owner.token, {
        'X-Offset': '0',
        'X-Chunk-SHA256': hash(chunk),
      })
    ).data.offset,
    20,
  );
  const resumed = (await f.request('/transfers', 'POST', offer, f.owner.token)).data;
  assert.equal(resumed.id, t.id);
  assert.equal(resumed.offset, 20);
  assert.equal(
    (await f.request(`/transfers/${t.id}/complete`, 'POST', {}, f.owner.token)).status,
    409,
  );
  const remainder = contents.subarray(20);
  await f.request(`/transfers/${t.id}/chunk`, 'PUT', remainder, f.owner.token, {
    'X-Offset': '20',
    'X-Chunk-SHA256': hash(remainder),
  });
  assert.equal(
    (await f.request(`/transfers/${t.id}/complete`, 'POST', {}, f.owner.token)).data.status,
    'ready',
  );
  const download = await f.request(`/transfers/${t.id}/download`, 'GET', undefined, receiver.token);
  assert.equal(download.status, 200);
  assert.deepEqual(download.data, contents);
  assert.equal(download.headers.get('x-file-sha256'), hash(contents));
  assert.equal(
    (await f.request(`/transfers/${t.id}/download`, 'GET', undefined, outsider.token)).status,
    404,
  );
  assert.equal(
    (await f.request(`/transfers/${t.id}`, 'DELETE', undefined, receiver.token)).status,
    403,
  );
  assert.equal(
    (await f.request(`/transfers/${t.id}`, 'DELETE', undefined, f.owner.token)).status,
    200,
  );
});
test('acknowledged chunks allow immediate sequential writes and completion', async () => {
  const f = await fixture();
  const contents = Buffer.from(
    'Sequential chunks must release their lock before acknowledgment. '.repeat(32),
  );
  const offer = await f.request(
    '/transfers',
    'POST',
    {
      name: 'rapid-chunks.txt',
      size: contents.length,
      sha256: hash(contents),
    },
    f.owner.token,
  );
  assert.equal(offer.status, 201);
  const transfer = offer.data;
  for (let offset = 0; offset < contents.length; offset += 64) {
    const chunk = contents.subarray(offset, offset + 64);
    const saved = await f.request(`/transfers/${transfer.id}/chunk`, 'PUT', chunk, f.owner.token, {
      'X-Offset': String(offset),
      'X-Chunk-SHA256': hash(chunk),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.offset, offset + chunk.length);
  }
  const completed = await f.request(
    `/transfers/${transfer.id}/complete`,
    'POST',
    {},
    f.owner.token,
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const download = await f.request(
    `/transfers/${transfer.id}/download`,
    'GET',
    undefined,
    f.owner.token,
  );
  assert.deepEqual(download.data, contents);
});
test('empty files complete correctly, unsafe filenames and oversized offers fail', async () => {
  const f = await fixture();
  for (const name of ['../secret', 'folder\\secret', '\u0000file'])
    assert.equal(
      (await f.request('/transfers', 'POST', { name, size: 0, sha256: hash('') }, f.owner.token))
        .status,
      400,
    );
  assert.equal(
    (
      await f.request(
        '/transfers',
        'POST',
        { name: 'huge', size: 2 ** 40, sha256: hash('') },
        f.owner.token,
      )
    ).status,
    400,
  );
  const t = (
    await f.request(
      '/transfers',
      'POST',
      { name: 'empty.txt', size: 0, sha256: hash('') },
      f.owner.token,
    )
  ).data;
  assert.equal(
    (await f.request(`/transfers/${t.id}/complete`, 'POST', {}, f.owner.token)).status,
    200,
  );
  assert.equal(
    (await f.request(`/transfers/${t.id}/download`, 'GET', undefined, f.owner.token)).data.length,
    0,
  );
});
test('whole-file mismatch never makes a corrupt file downloadable', async () => {
  const f = await fixture();
  const data = Buffer.from('corrupt');
  const t = (
    await f.request(
      '/transfers',
      'POST',
      { name: 'bad.txt', size: data.length, sha256: hash('correct') },
      f.owner.token,
    )
  ).data;
  await f.request(`/transfers/${t.id}/chunk`, 'PUT', data, f.owner.token, {
    'X-Offset': '0',
    'X-Chunk-SHA256': hash(data),
  });
  assert.equal(
    (await f.request(`/transfers/${t.id}/complete`, 'POST', {}, f.owner.token)).status,
    422,
  );
  assert.equal(
    (await f.request(`/transfers/${t.id}/download`, 'GET', undefined, f.owner.token)).status,
    404,
  );
});
test('chat, notes, and targeted alerts are permissioned and persisted', async () => {
  const f = await fixture();
  const member = await f.pair();
  await f.request('/messages', 'POST', { text: 'Hello from Mac' }, f.owner.token);
  await f.request('/notes', 'POST', { text: 'A shared reminder', color: 'peach' }, member.token);
  const n = await f.request(
    '/notifications',
    'POST',
    { target: member.device.id, title: 'Build finished', body: 'Ready for review' },
    f.owner.token,
  );
  const state = (await f.request('/state', 'GET', undefined, member.token)).data;
  assert.equal(state.messages[0].text, 'Hello from Mac');
  assert.equal(state.notes[0].text, 'A shared reminder');
  assert.equal(state.notifications.length, 1);
  assert.equal(
    (await f.request('/state', 'GET', undefined, f.owner.token)).data.notifications.length,
    0,
  );
  await f.request(`/notifications/${n.data.id}`, 'DELETE', undefined, member.token);
  assert.equal(
    (await f.request('/state', 'GET', undefined, member.token)).data.notifications.length,
    0,
  );
});
test('owner boundaries, revocation, and lockdown invalidate access and invitations', async () => {
  const f = await fixture();
  const a = await f.pair();
  const b = await f.pair();
  assert.equal(
    (await f.request('/settings', 'PATCH', { name: 'Taken over', retentionDays: 7 }, a.token))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request(
        `/devices/${a.device.id}`,
        'PATCH',
        { permissions: { ...a.device.permissions, screen: true } },
        a.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.request(`/devices/${f.owner.device.id}`, 'DELETE', undefined, f.owner.token)).status,
    400,
  );
  await f.request(`/devices/${a.device.id}`, 'DELETE', undefined, f.owner.token);
  assert.equal((await f.request('/state', 'GET', undefined, a.token)).status, 401);
  const invite = await f.request('/invitations', 'POST', {}, f.owner.token);
  await f.request('/lockdown', 'POST', {}, f.owner.token);
  assert.equal((await f.request('/state', 'GET', undefined, b.token)).status, 401);
  assert.equal((await f.request('/state', 'GET', undefined, f.owner.token)).status, 200);
  assert.equal(
    (
      await f.request('/join', 'POST', {
        code: invite.data.code,
        name: 'Blocked',
        platform: 'Browser',
      })
    ).status,
    401,
  );
});
test('CSRF, hostile origins and DNS-rebinding hosts are rejected', async () => {
  const f = await fixture();
  assert.equal(
    (await f.request('/messages', 'POST', { text: 'CSRF' }, f.owner.token, { 'X-Omni-Client': '' }))
      .status,
    403,
  );
  assert.equal(
    (await f.request('/state', 'GET', undefined, f.owner.token, { Origin: 'https://evil.example' }))
      .status,
    403,
  );
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      f.base + '/api/state',
      { headers: { Host: 'evil.example', Authorization: `Bearer ${f.owner.token}` } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  const response = await f.request('/state', 'GET', undefined, f.owner.token);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('audit verifies genuine records and detects modified history', async () => {
  const f = await fixture();
  await f.pair();
  const valid = (await f.request('/audit/verify', 'GET', undefined, f.owner.token)).data;
  assert.equal(valid.valid, true);
  assert.ok(valid.count >= 3);
  f.instance.store.run("UPDATE audit SET detail='tampered' WHERE seq=1");
  assert.equal(
    (await f.request('/audit/verify', 'GET', undefined, f.owner.token)).data.valid,
    false,
  );
});
test('WebSocket authenticates clients, requires screen consent, and closes revoked devices', async () => {
  const f = await fixture();
  const member = await f.pair();
  await f.request(
    `/devices/${member.device.id}`,
    'PATCH',
    { permissions: { ...member.device.permissions, screen: true } },
    f.owner.token,
  );
  const connect = async (token) => {
    const ws = new WebSocket(f.base.replace('http', 'ws') + '/events', {
      headers: { Host: 'localhost', Origin: 'http://localhost', Authorization: `Bearer ${token}` },
    });
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return { ws, messages };
  };
  const a = await connect(f.owner.token);
  const b = await connect(member.token);
  const waitFor = async (client, type) => {
    for (let i = 0; i < 100; i++) {
      const message = client.messages.find((m) => m.type === type);
      if (message) return message;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Missing ${type}`);
  };
  a.ws.send(JSON.stringify({ type: 'screen.request', to: member.device.id }));
  const invitation = await waitFor(b, 'screen.request');
  a.ws.send(
    JSON.stringify({
      type: 'screen.signal',
      callId: invitation.callId,
      signal: { description: { type: 'offer', sdp: 'test' } },
    }),
  );
  assert.match((await waitFor(a, 'error')).error, /Unsupported/);
  b.ws.send(JSON.stringify({ type: 'screen.accept', callId: invitation.callId }));
  await waitFor(a, 'screen.accept');
  a.ws.send(
    JSON.stringify({
      type: 'screen.signal',
      callId: invitation.callId,
      signal: { description: { type: 'offer', sdp: 'test-sdp' } },
    }),
  );
  assert.equal((await waitFor(b, 'screen.signal')).signal.description.sdp, 'test-sdp');
  const closed = new Promise((resolve) => b.ws.once('close', (code) => resolve(code)));
  await f.request(`/devices/${member.device.id}`, 'DELETE', undefined, f.owner.token);
  assert.equal(await closed, 4001);
  a.ws.close();
});
test('state and sessions survive a service restart', async () => {
  const f = await fixture();
  await f.request('/clipboard', 'POST', { text: 'Still here after restart' }, f.owner.token);
  await f.instance.close();
  resources.splice(
    resources.findIndex((r) => r.instance === f.instance),
    1,
  );
  const instance = createOmniServer({ dataDir: f.directory, origins: ['http://localhost'] });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  resources.push({ instance, directory: f.directory });
  instance.origins.add(`http://127.0.0.1:${instance.server.address().port}`);
  const response = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/state`, {
    headers: { Host: 'localhost', Authorization: `Bearer ${f.owner.token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).clips[0].text, 'Still here after restart');
});
