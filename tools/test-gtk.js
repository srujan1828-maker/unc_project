import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createOmniServer } from '../server/app.js';

const directory = await mkdtemp(join(tmpdir(), 'omni-gtk-'));
const service = createOmniServer({ dataDir: directory, bootstrapKey: 'gtk-test' });
await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${service.server.address().port}`;
service.origins.add(origin);
try {
  const response = await fetch(origin + '/api/setup', {
    method: 'POST',
    headers: { 'X-Omni-Client': '1', 'X-Omni-Cli': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: 'gtk-test',
      name: 'GTK test device',
      platform: 'Linux',
      spaceName: 'GTK test workspace',
    }),
  });
  const owner = await response.json();
  const fixture = join(directory, 'fixture.json');
  await writeFile(fixture, JSON.stringify({ origin, token: owner.token }), { mode: 0o600 });
  const child = spawn(
    process.env.OMNI_SYSTEM_PYTHON || '/usr/bin/python3',
    ['tests/gtk-smoke.py', fixture],
    {
      stdio: 'inherit',
      env: { ...process.env, XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: join(directory, 'cache') },
    },
  );
  process.exitCode = await new Promise((r) => child.once('exit', (code) => r(code || 0)));
} finally {
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
