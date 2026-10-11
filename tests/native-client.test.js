import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createOmniServer } from '../server/app.js';
const exec = promisify(execFile);

test('Linux transport pairs, shares clipboard, uploads, verifies and downloads against the service', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'omni-native-'));
  const service = createOmniServer({ dataDir, bootstrapKey: 'native-test' });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  service.origins.add(origin);
  const post = async (path, body, token) =>
    (
      await fetch(origin + '/api' + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Omni-Client': '1',
          'X-Omni-Cli': '1',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
    ).json();
  try {
    const owner = await post('/setup', {
      name: 'Owner',
      platform: 'Browser',
      spaceName: 'Native tests',
      key: 'native-test',
    });
    const invite = await post('/invitations', {}, owner.token);
    const fixture = join(dataDir, 'fixture.json');
    await writeFile(fixture, JSON.stringify({ origin, code: invite.code }), { mode: 0o600 });
    const result = await exec('python3', [
      '-c',
      `
import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('omni',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
fixture=json.loads(pathlib.Path(sys.argv[2]).read_text()); client=module.Client(fixture['origin'])
data=client.json('/join','POST',{'code':fixture['code'],'name':'Linux native','platform':'Linux'}); client.token=data['token']
client.json('/clipboard','POST',{'text':'From a real Python native transport'})
source=pathlib.Path(sys.argv[2]).parent/'original.txt'; source.write_text('Verified native upload ✓')
transfer=client.upload(source); destination=source.with_name('downloaded.txt'); client.download(transfer,destination)
assert destination.read_bytes()==source.read_bytes()
assert client.json('/state')['clips'][0]['text']=='From a real Python native transport'
print('Linux transport integration passed')
`,
      resolve('apps/linux/client.py'),
      fixture,
    ]);
    assert.match(result.stdout, /integration passed/);
  } finally {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('CLI sends and receives verified files and refuses to reuse tokens for a different origin', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'omni-cli-'));
  const service = createOmniServer({ dataDir, bootstrapKey: 'cli-test' });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  service.origins.add(origin);
  try {
    const response = await fetch(origin + '/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Omni-Client': '1', 'X-Omni-Cli': '1' },
      body: JSON.stringify({
        name: 'Owner CLI',
        platform: 'CLI',
        spaceName: 'CLI tests',
        key: 'cli-test',
      }),
    });
    const owner = await response.json();
    const config = join(dataDir, 'cli.json');
    await writeFile(config, JSON.stringify({ server: origin, token: owner.token }), {
      mode: 0o600,
    });
    const cli = (...args) => exec(process.execPath, ['tools/omni.js', '--config', config, ...args]);
    const source = join(dataDir, 'send.txt');
    await writeFile(source, 'CLI file contents');
    const sent = JSON.parse((await cli('send', source, '--json')).stdout);
    assert.equal(sent.status, 'ready');
    const received = await cli('receive', sent.id, '--output', join(dataDir, 'received.txt'));
    assert.match(received.stdout, /Verified file saved/);
    await cli('clipboard', 'A message from the CLI');
    assert.equal(JSON.parse((await cli('clipboard')).stdout)[0].text, 'A message from the CLI');
    await assert.rejects(
      cli('state', '--server', 'https://another.example'),
      /Pair this terminal first/,
    );
  } finally {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
