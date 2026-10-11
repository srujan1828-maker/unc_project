import { readFileSync } from 'node:fs';
import { createOmniServer } from './app.js';

const host = process.env.OMNI_HOST || '127.0.0.1';
const port = Number(process.env.OMNI_PORT || 47800);
const tls =
  process.env.OMNI_TLS_CERT && process.env.OMNI_TLS_KEY
    ? {
        cert: readFileSync(process.env.OMNI_TLS_CERT),
        key: readFileSync(process.env.OMNI_TLS_KEY),
        minVersion: 'TLSv1.3',
      }
    : undefined;
const secureProxy = process.env.OMNI_SECURE_PROXY === '1';
if (!['localhost', '127.0.0.1', '::1'].includes(host) && !tls) {
  throw new Error(
    'A public/LAN bind requires OMNI_TLS_CERT and OMNI_TLS_KEY. For a trusted HTTPS reverse proxy, keep OMNI_HOST=127.0.0.1 and set OMNI_SECURE_PROXY=1.',
  );
}
const instance = createOmniServer({
  dataDir: process.env.OMNI_DATA_DIR,
  tls,
  secureProxy,
  origins: process.env.OMNI_ORIGINS?.split(',').map((s) => s.trim()),
  onError: (err) => console.error('Server operation failed:', err.code || err.name),
});
instance.server.listen(port, host, () => {
  console.log(`OmniSync service listening on ${host}:${port}.`);
  console.log(`First-run setup key, when needed: ${instance.bootstrapFile}`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await instance.close();
    process.exit(0);
  });
