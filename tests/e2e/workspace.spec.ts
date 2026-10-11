import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('two browsers pair, exchange clipboard/files/chat, persist after reload, and revoke access; screen consent and signaling work', async ({
  browser,
}) => {
  const errors: string[] = [];
  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  owner.on('pageerror', (e) => errors.push(e.message));
  member.on('pageerror', (e) => errors.push(e.message));
  await owner.goto('/');
  await owner.getByLabel('Device name', { exact: true }).fill('Srujan’s MacBook');
  await owner.getByLabel('Workspace name').fill('My creative space');
  await owner.getByLabel('Local setup key').fill('browser-test-key');
  await owner.getByRole('button', { name: 'Create workspace' }).click();
  await expect(owner.getByRole('heading', { name: 'Everything, in good company.' })).toBeVisible();
  await owner.getByRole('button', { name: 'Add device', exact: true }).click();
  await owner.getByRole('button', { name: /My device or a trusted member/ }).click();
  const code = (await owner.locator('.invite-code strong').innerText()).replace(/ /g, '');
  await member.goto('/');
  await member.getByLabel('Device name', { exact: true }).fill('Pixel companion');
  await member.getByLabel('Pairing code').fill(code);
  await member.getByRole('button', { name: 'Join workspace' }).click();
  await expect(member.getByRole('heading', { name: 'Everything, in good company.' })).toBeVisible();
  await owner.getByLabel('Close dialog').click();
  await expect(owner.getByRole('heading', { name: 'Pixel companion' })).toBeVisible();
  await owner.getByLabel('Text to share').fill('Pick up this idea on your phone.');
  await owner.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(member.locator('.clip-content')).toHaveText('Pick up this idea on your phone.');
  await owner.locator('input[type=file]').setInputFiles({
    name: 'hello-omnisync.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A real cross-device file.\n'),
  });
  await owner.getByRole('button', { name: 'File transfers', exact: false }).first().click();
  await expect(owner.getByRole('link', { name: 'Download hello-omnisync.txt' })).toBeVisible();
  await member.getByRole('button', { name: 'File transfers', exact: false }).first().click();
  const downloadEvent = member.waitForEvent('download');
  await member.getByRole('link', { name: 'Download hello-omnisync.txt' }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, 'utf8')).toBe('A real cross-device file.\n');
  await owner.getByRole('button', { name: 'Space chat', exact: true }).click();
  await member.getByRole('button', { name: 'Space chat', exact: true }).click();
  await member.getByLabel('Message', { exact: true }).fill('Hello from my phone!');
  await member.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(owner.locator('.message p')).toHaveText('Hello from my phone!');
  await owner.getByRole('button', { name: 'Add note', exact: true }).click();
  await owner.getByLabel('Your note').fill('Build something thoughtful.');
  await owner.getByRole('button', { name: 'Add to board' }).click();
  await expect(member.locator('.sticky-note p')).toHaveText('Build something thoughtful.');
  await owner.getByRole('button', { name: 'Collaboration', exact: true }).click();
  await member.getByRole('button', { name: 'Collaboration', exact: true }).click();
  await owner.getByLabel('Shared scratchpad').fill('A shared starting point.');
  await expect(member.getByLabel('Shared scratchpad')).toHaveValue('A shared starting point.');
  await memberContext.setOffline(true);
  await expect(member.locator('.connection-indicator')).toContainText('Reconnecting');
  await member.getByLabel('Shared scratchpad').fill('A shared starting point. A phone idea.');
  await owner.getByLabel('Shared scratchpad').fill('A shared starting point. A desktop idea.');
  await memberContext.setOffline(false);
  await expect(owner.getByLabel('Shared scratchpad')).toHaveValue(/phone idea/);
  await expect(owner.getByLabel('Shared scratchpad')).toHaveValue(/desktop idea/);
  await expect(member.getByLabel('Shared scratchpad')).toHaveValue(
    await owner.getByLabel('Shared scratchpad').inputValue(),
  );
  await owner.getByRole('button', { name: 'Add task', exact: true }).click();
  await owner.getByLabel('What needs doing?').fill('Review the launch notes');
  await owner.getByRole('dialog').getByRole('button', { name: 'Add task' }).click();
  await expect(member.locator('.task-card')).toContainText('Review the launch notes');
  await member.getByLabel('Status of Review the launch notes').selectOption('doing');
  await expect(owner.getByLabel('Status of Review the launch notes')).toHaveValue('doing');
  await owner.getByLabel('Request a file').click();
  await owner.getByLabel('Which file do you need?').fill('Please send the project brief');
  await owner.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(member.locator('.file-requests')).toContainText('Please send the project brief');
  await member.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(owner.locator('.file-requests .badge')).toHaveText('declined');
  await member.getByLabel('Your presence').selectOption('focus');
  await expect(owner.locator('.collab-people')).toContainText('focus');
  await owner.screenshot({ path: 'test-results/collaboration-workspace.png', fullPage: true });
  await member.reload();
  await expect(member.getByRole('heading', { name: 'Everything, in good company.' })).toBeVisible();
  await expect(member.locator('.clip-content')).toHaveText('Pick up this idea on your phone.');
  await owner.getByRole('button', { name: 'Overview', exact: true }).click();
  const accessibility = await new AxeBuilder({ page: owner })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await owner.screenshot({ path: 'test-results/desktop-workspace.png', fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(owner.getByRole('heading', { name: 'Everything, in good company.' })).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await owner.screenshot({ path: 'test-results/mobile-workspace.png', fullPage: true });
  await owner.getByLabel('Open navigation').click();
  await owner.getByRole('button', { name: 'Settings', exact: true }).click();
  await owner.getByRole('switch', { name: 'Dark appearance' }).click();
  await expect(owner.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkAccessibility = await new AxeBuilder({ page: owner })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    darkAccessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await owner.getByRole('switch', { name: 'Dark appearance' }).click();
  await owner.setViewportSize({ width: 1440, height: 1000 });
  await owner.getByRole('button', { name: 'My devices', exact: false }).first().click();
  await owner
    .getByRole('button', {
      name: /Pixel companion.*Custom permissions|Pixel companion.*Files & clipboard/,
    })
    .click();
  await owner.getByRole('switch', { name: 'Screen sharing permission' }).click();
  await owner.getByLabel('Close dialog').click();
  await owner.getByRole('button', { name: 'Screen sharing', exact: true }).click();
  // A deterministic canvas track replaces the OS picker only in this browser test.
  // The invitation, consent, ICE/SDP exchange and received video are real WebRTC.
  await Promise.all(
    [owner, member].map((page) =>
      page.evaluate(() => {
        const Original = window.RTCPeerConnection;
        (window as any).__peers = [];
        window.RTCPeerConnection = class extends Original {
          constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
            super(...args);
            (window as any).__peers.push(this);
          }
        };
      }),
    ),
  );
  await owner.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.fillStyle = '#315D43';
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = 'white';
        context.font = '30px sans-serif';
        context.fillText('OmniSync screen test ' + Date.now(), 20, 100);
      };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  });
  await owner.locator('.screen-device').getByRole('button', { name: 'Share', exact: true }).click();
  await expect(member.getByRole('dialog', { name: 'A screen-sharing invitation' })).toBeVisible();
  await expect(member.locator('video')).toHaveCount(0);
  await member.getByRole('button', { name: 'Accept & view' }).click();
  await expect
    .poll(() => owner.evaluate(() => (window as any).__peers[0]?.remoteDescription?.type))
    .toBe('answer');
  await expect(member.locator('.screen-controls')).toContainText(/connecting|live/);
  await owner.getByRole('button', { name: 'Stop session' }).click();
  await expect(member.locator('video')).toHaveCount(0);
  await owner.getByRole('button', { name: 'My devices', exact: false }).first().click();
  await owner.getByRole('button', { name: /Pixel companion.*Files & clipboard/ }).click();
  await owner.getByRole('switch', { name: 'Clipboard permission' }).click();
  await member.getByRole('button', { name: 'Clipboard', exact: true }).click();
  await expect(member.getByLabel('Text to share')).toBeDisabled();
  owner.once('dialog', (dialog) => dialog.accept());
  await owner.getByRole('button', { name: 'Revoke device access' }).click();
  await expect(member.getByRole('button', { name: 'Join workspace' })).toBeVisible();
  expect(errors).toEqual([]);
  await ownerContext.close();
  await memberContext.close();
});
