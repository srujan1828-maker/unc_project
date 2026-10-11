import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOmniServer } from '../../server/app.js';
const directory = mkdtempSync(join(tmpdir(), 'omni-browser-'));
const instance = createOmniServer({
  dataDir: directory,
  bootstrapKey: 'browser-test-key',
  origins: ['http://127.0.0.1:47820'],
});
instance.server.listen(47820, '127.0.0.1');
process.on('SIGTERM', async () => {
  await instance.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
});
