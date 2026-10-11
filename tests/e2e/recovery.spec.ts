import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOmniServer } from '../../server/app.js';
import { createOwnerRecovery } from '../../server/recovery.js';

test('a new browser recovers owner access using a private local key', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-recovery-browser-'));
  const service = createOmniServer({
    dataDir: directory,
    bootstrapKey: 'recovery-browser-fixture',
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(service.server.address() as any).port}`;
  service.origins.add(origin);
  const original = await browser.newContext();
  const replacement = await browser.newContext();
  try {
    const setup = await original.request.post(origin + '/api/setup', {
      headers: { 'X-Omni-Client': '1' },
      data: {
        key: 'recovery-browser-fixture',
        name: 'Original owner',
        platform: 'Browser',
        spaceName: 'Recovered workspace',
      },
    });
    expect(setup.status()).toBe(201);
    const recovery = createOwnerRecovery(directory);
    const key = (await readFile(recovery.path, 'utf8')).trim();
    const page = await replacement.newPage();
    await page.goto(origin);
    await page.getByRole('button', { name: 'Recover owner access', exact: true }).click();
    await page.getByLabel('Local recovery key').fill(key);
    await page.getByRole('button', { name: 'Restore owner access' }).click();
    await expect(page.getByRole('heading', { name: 'Everything, in good company.' })).toBeVisible();
    await expect(page.locator('.space-switcher')).toContainText('Recovered workspace');
    expect((await original.request.get(origin + '/api/state')).status()).toBe(401);
    const state = await (await replacement.request.get(origin + '/api/state')).json();
    expect(state.me.role).toBe('owner');
    expect(state.me.name).toBe('Original owner');
  } finally {
    await original.close();
    await replacement.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
