import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createOmniServer } from '../server/app.js';

test('collaboration enforces observer roles, task versions, file-request consent, and CRDT merging', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'omni-collab-'));
  const service = createOmniServer({ dataDir, bootstrapKey: 'collab-test' });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  service.origins.add(base);
  const request = async (path, method = 'GET', body, token) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: {
        'X-Omni-Client': '1',
        'X-Omni-Cli': '1',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const clients = [];
  try {
    const owner = (
      await request('/setup', 'POST', {
        key: 'collab-test',
        name: 'Owner',
        platform: 'Browser',
        spaceName: 'Collaborators',
      })
    ).data;
    const pair = async (role) => {
      const invite = (await request('/invitations', 'POST', { role }, owner.token)).data;
      return (
        await request('/join', 'POST', { code: invite.code, name: role, platform: 'Browser' })
      ).data;
    };
    const member = await pair('member'),
      observer = await pair('observer'),
      guest = await pair('guest');
    for (const reader of [observer, guest]) {
      assert.equal(
        (await request('/messages', 'POST', { text: 'Should fail' }, reader.token)).status,
        403,
      );
      assert.equal(
        (await request('/notes', 'POST', { text: 'Should fail' }, reader.token)).status,
        403,
      );
      assert.equal(
        (await request('/tasks', 'POST', { text: 'Should fail' }, reader.token)).status,
        403,
      );
      assert.equal((await request('/state', 'GET', undefined, reader.token)).status, 200);
    }
    const task = (
      await request(
        '/tasks',
        'POST',
        { text: 'Review the new design', assignee: member.device.id, due: '2026-10-20' },
        owner.token,
      )
    ).data;
    assert.equal(
      (await request(`/tasks/${task.id}`, 'PATCH', { status: 'doing', version: 1 }, member.token))
        .status,
      200,
    );
    assert.equal(
      (await request(`/tasks/${task.id}`, 'PATCH', { status: 'done', version: 1 }, owner.token))
        .status,
      409,
    );
    const fileRequest = (
      await request(
        '/file-requests',
        'POST',
        { target: member.device.id, text: 'Please send the report' },
        owner.token,
      )
    ).data;
    assert.equal(
      (
        await request(
          `/file-requests/${fileRequest.id}`,
          'PATCH',
          { status: 'fulfilled' },
          owner.token,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/file-requests/${fileRequest.id}`,
          'PATCH',
          { status: 'declined' },
          member.token,
        )
      ).status,
      200,
    );
    await request('/presence', 'PATCH', { status: 'focus' }, member.token);
    assert.equal((await request('/state', 'GET', undefined, member.token)).data.focusMode, true);
    const ws = new WebSocket(base.replace('http', 'ws') + '/events', {
      headers: { Origin: base, Authorization: `Bearer ${owner.token}` },
    });
    clients.push(ws);
    await new Promise((r) => ws.once('open', r));
    const replies = [];
    ws.on('message', (data) => replies.push(JSON.parse(data)));
    const left = new Y.Doc(),
      right = new Y.Doc();
    left.getText('scratchpad').insert(0, 'Left offline edit. ');
    right.getText('scratchpad').insert(0, 'Right offline edit. ');
    for (const doc of [left, right])
      ws.send(
        JSON.stringify({
          type: 'scratchpad.update',
          update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
        }),
      );
    for (
      let i = 0;
      i < 100 && replies.filter((r) => r.type === 'scratchpad.update').length < 2;
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(replies.filter((r) => r.type === 'scratchpad.update').length, 2);
    const snapshot = (await request('/collaboration', 'GET', undefined, observer.token)).data;
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Buffer.from(snapshot.scratchpad, 'base64'));
    assert.match(merged.getText('scratchpad').toString(), /Left offline edit/);
    assert.match(merged.getText('scratchpad').toString(), /Right offline edit/);
    assert.ok(service.store.one("SELECT value FROM settings WHERE key='scratchpad'"));
    left.destroy();
    right.destroy();
    merged.destroy();
  } finally {
    clients.forEach((ws) => ws.terminate());
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
