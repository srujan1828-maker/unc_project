#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string' },
    config: { type: 'string' },
    name: { type: 'string' },
    to: { type: 'string' },
    output: { type: 'string' },
    json: { type: 'boolean' },
    guest: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
const configPath =
  values.config ||
  process.env.OMNI_CLIENT_CONFIG ||
  join(homedir(), '.config', 'omnisync', 'cli.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const base = new URL(values.server || config.server || 'http://127.0.0.1:47800');
if (
  base.protocol !== 'https:' &&
  !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
)
  throw new Error('Use HTTPS for any service outside localhost.');
if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
  throw new Error('Provide only a server origin, such as https://desktop.example:47800.');
// A command-line override must never leak an existing credential to a new host.
const token = config.server === base.origin ? config.token : undefined;
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function request(path, method = 'GET', body, headers = {}) {
  const response = await fetch(new URL(`/api${path}`, base), {
    method,
    redirect: 'error',
    headers: {
      'X-Omni-Client': '1',
      'X-Omni-Cli': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response;
}
const json = async (...args) => (await request(...args)).json();
const display = (value) => console.log(JSON.stringify(value, null, 2));
async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
async function main() {
  const [command, argument] = positionals;
  if (!command || values.help) {
    console.log(
      `OmniSync CLI\n\n  omni join --server https://your-host:47800 --name "My terminal"\n  omni devices\n  omni clipboard [text]       Omit text to list shared items\n  omni send path [--to DEVICE_ID]\n  omni files\n  omni receive ID --output path\n  omni chat [message]\n  omni invite [--guest]       Owner devices only\n  omni state\n\nPairing prompts for a single-use code. Data uses a local service; use trusted HTTPS for LAN.\n--config PATH changes the private credential file. --server never reuses credentials for another origin.`,
    );
    return;
  }
  if (command === 'join') {
    const code = await prompt('Pairing code: ');
    const data = await json('/join', 'POST', {
      code,
      name: values.name || 'My terminal',
      platform: 'CLI',
    });
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath, JSON.stringify({ server: base.origin, token: data.token }), {
      mode: 0o600,
    });
    chmodSync(configPath, 0o600);
    console.log(`Paired as ${data.device.name}. Session stored in a private local file.`);
    return;
  }
  if (!token) throw new Error('Pair this terminal first with omni join.');
  if (command === 'state') return display(await json('/state'));
  if (command === 'devices') return display((await json('/state')).devices);
  if (command === 'files') return display((await json('/state')).transfers);
  if (command === 'invite')
    return display(await json('/invitations', 'POST', { role: values.guest ? 'guest' : 'member' }));
  if (command === 'clipboard')
    return display(
      argument === undefined
        ? (await json('/state')).clips
        : await json('/clipboard', 'POST', {
            text: positionals.slice(1).join(' '),
            target: values.to || null,
          }),
    );
  if (command === 'chat')
    return display(
      argument === undefined
        ? (await json('/state')).messages
        : await json('/messages', 'POST', { text: positionals.slice(1).join(' ') }),
    );
  if (command === 'send') {
    if (!argument) throw new Error('Provide the path to a file.');
    const path = resolve(argument);
    const file = await open(path, 'r');
    try {
      const metadata = await file.stat();
      if (!metadata.isFile()) throw new Error('Choose a file, not a directory.');
      const hasher = createHash('sha256');
      for await (const chunk of createReadStream(path)) hasher.update(chunk);
      const transfer = await json('/transfers', 'POST', {
        name: basename(path),
        size: metadata.size,
        sha256: hasher.digest('hex'),
        target: values.to || null,
      });
      let offset = transfer.offset;
      while (offset < metadata.size) {
        const buffer = Buffer.alloc(Math.min(1024 * 1024, metadata.size - offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) throw new Error('The file changed during upload.');
        const chunk = buffer.subarray(0, bytesRead);
        offset = (
          await json(`/transfers/${transfer.id}/chunk`, 'PUT', chunk, {
            'X-Offset': String(offset),
            'X-Chunk-SHA256': hash(chunk),
          })
        ).offset;
        if (!values.json)
          process.stderr.write(`\rUploading ${Math.round((offset / metadata.size) * 100)}%`);
      }
      const result = await json(`/transfers/${transfer.id}/complete`, 'POST', {});
      if (!values.json) process.stderr.write('\n');
      display(result);
    } finally {
      await file.close();
    }
    return;
  }
  if (command === 'receive') {
    if (!argument || !values.output) throw new Error('Use receive ID --output PATH.');
    const response = await request(`/transfers/${encodeURIComponent(argument)}/download`);
    const output = resolve(values.output);
    const partial = output + '.omni-part';
    if (existsSync(output)) throw new Error('The output file already exists. Choose a new path.');
    const file = await open(partial, 'wx', 0o600);
    const digest = createHash('sha256');
    try {
      for await (const chunk of response.body) {
        digest.update(chunk);
        await file.write(chunk);
      }
      await file.close();
      if (digest.digest('hex') !== response.headers.get('x-file-sha256'))
        throw new Error('Download checksum did not match.');
      await rename(partial, output);
      console.log(`Verified file saved to ${output}`);
    } catch (e) {
      await file.close().catch(() => {});
      await unlink(partial).catch(() => {});
      throw e;
    }
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
