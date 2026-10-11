import { test, expect } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOmniServer } from '../../server/app.js';

test('consented screen video reaches a second browser and stops on request', async ({
  browser,
}) => {
  const managedPolicy = await readFile('/etc/chromium/policies/managed/misc.json', 'utf8').catch(
    () => '{}',
  );
  test.skip(
    JSON.parse(managedPolicy).WebRtcIPHandling === 'disable_non_proxied_udp',
    'Managed browser policy disables direct WebRTC UDP. Run this test on a normal desktop/CI browser to validate media delivery.',
  );
  const directory = await mkdtemp(join(tmpdir(), 'omni-media-'));
  const service = createOmniServer({ dataDir: directory, bootstrapKey: 'media-test' });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(service.server.address() as any).port}`;
  service.origins.add(base);
  const a = await browser.newContext();
  const b = await browser.newContext();
  try {
    const headers = { 'X-Omni-Client': '1' };
    await a.request.post(base + '/api/setup', {
      headers,
      data: { key: 'media-test', name: 'Presenter', platform: 'Browser', spaceName: 'Media test' },
    });
    const invitation = await (
      await a.request.post(base + '/api/invitations', {
        headers,
        data: {
          permissions: {
            files: true,
            clipboard: true,
            chat: true,
            notifications: true,
            screen: true,
          },
        },
      })
    ).json();
    await b.request.post(base + '/api/join', {
      headers,
      data: { code: invitation.code, name: 'Viewer', platform: 'Browser' },
    });
    const presenter = await a.newPage();
    const viewer = await b.newPage();
    await presenter.goto(base);
    await viewer.goto(base);
    await presenter.getByRole('button', { name: 'Screen sharing', exact: true }).click();
    await presenter.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        setInterval(() => {
          ctx.fillStyle = '#315D43';
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = 'white';
          ctx.fillText(String(Date.now()), 30, 30);
        }, 100);
        return canvas.captureStream(10);
      };
    });
    await presenter
      .locator('.screen-device')
      .getByRole('button', { name: 'Share', exact: true })
      .click();
    await viewer.getByRole('button', { name: 'Accept & view' }).click();
    await expect
      .poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth), {
        timeout: 15000,
      })
      .toBe(640);
    await expect(viewer.locator('.screen-controls')).toContainText('live');
    await presenter.getByRole('button', { name: 'Stop session' }).click();
    await expect(viewer.locator('video')).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
