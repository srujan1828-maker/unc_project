import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createOmniServer } from '../server/app.js';

const directory = await mkdtemp(join(tmpdir(), 'omni-swift-'));
const service = createOmniServer({ dataDir: directory, bootstrapKey: 'swift-test-fixture' });
await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${service.server.address().port}`;
service.origins.add(origin);
let redirectedRequests = 0;
const receiver = createServer((req, res) => {
  if (req.url === '/count') {
    res.end(String(redirectedRequests));
    return;
  }
  redirectedRequests++;
  res.writeHead(418).end();
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const receiverOrigin = `http://127.0.0.1:${receiver.address().port}`;
const redirect = createServer((req, res) => {
  res.writeHead(302, { Location: receiverOrigin + '/api/state' }).end();
});
await new Promise((r) => redirect.listen(0, '127.0.0.1', r));
const redirectOrigin = `http://127.0.0.1:${redirect.address().port}`;
try {
  const request = async (path, body, token) => {
    const response = await fetch(origin + '/api' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Omni-Client': '1',
        'X-Omni-Cli': '1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Fixture request ${path} failed: ${response.status}`);
    return response.json();
  };
  const owner = await request('/setup', {
    key: 'swift-test-fixture',
    name: 'Swift fixture owner',
    platform: 'Browser',
    spaceName: 'Swift integration',
  });
  const invitation = await request('/invitations', {}, owner.token);
  const fixture = join(directory, 'fixture.json');
  await writeFile(
    fixture,
    JSON.stringify({
      origin,
      code: invitation.code,
      ownerToken: owner.token,
      ownerID: owner.device.id,
      redirectOrigin,
      receiverOrigin,
    }),
    { mode: 0o600 },
  );
  const child = spawn(
    process.env.SWIFT_PATH || 'swift',
    ['test', '--package-path', resolve('apps/macos'), '--jobs', '4', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, OMNI_SWIFT_FIXTURE: fixture },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await Promise.all(
    [receiver, redirect].map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        }),
    ),
  );
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
