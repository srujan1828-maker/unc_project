import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Clipboard,
  Files,
  Link2,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
} from 'lucide-react';
import { api, platform } from './api';
import { Brand } from './components';

export default function Onboarding({
  initialized,
  onComplete,
  notify,
}: {
  initialized: boolean;
  onComplete: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
}) {
  const [mode, setMode] = useState<'create' | 'join' | 'recover'>(initialized ? 'join' : 'create');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(
        mode === 'create' ? '/setup' : mode === 'recover' ? '/recover-owner' : '/join',
        'POST',
        {
          name: data.get('name'),
          platform: platform(),
          ...(mode === 'create'
            ? { key: data.get('key'), spaceName: data.get('spaceName') }
            : mode === 'recover'
              ? { key: data.get('key') }
              : { code: data.get('code') }),
        },
      );
      await onComplete();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding">
      <section className="onboarding-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">
            <span className="status-dot" /> LESS FRICTION. MORE FLOW.
          </span>
          <h1>
            Your devices.
            <br />
            Better together.
          </h1>
          <p>
            A thought on your phone. A file on your laptop.
            <br />
            Bring it all into one calm, connected workspace.
          </p>
          <div className="orbit-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-center">
              <img src="/icon.svg" alt="" />
            </div>
            <span className="orbit-item orbit-laptop">
              <MonitorSmartphone size={34} />
            </span>
            <span className="orbit-item orbit-file">
              <Files size={27} />
            </span>
            <span className="orbit-item orbit-clip">
              <Clipboard size={27} />
            </span>
            <span className="orbit-small">✦</span>
          </div>
          <div className="story-features">
            <span>
              <Check size={16} /> Local-first
            </span>
            <span>
              <Check size={16} /> No account needed
            </span>
            <span>
              <Check size={16} /> Your permissions
            </span>
          </div>
        </div>
        <span className="story-footer">A little closer, wherever you work.</span>
      </section>
      <section className="onboarding-form">
        <div className="onboarding-form-inner">
          <span className="form-mark">
            <Link2 size={24} />
          </span>
          <span className="eyebrow">WELCOME TO OMNISYNC</span>
          <h2>
            {mode === 'create'
              ? 'Make yourself a space.'
              : mode === 'recover'
                ? 'Recover owner access.'
                : 'Bring this device along.'}
          </h2>
          <p>
            {mode === 'create'
              ? 'Your shared home for files, ideas, and everything in between.'
              : mode === 'recover'
                ? 'Use a recovery key created by the administrator on the service host.'
                : 'Enter a pairing code from the owner’s workspace to connect securely.'}
          </p>
          <form onSubmit={submit}>
            {mode !== 'recover' && (
              <label>
                Device name
                <input
                  name="name"
                  required
                  maxLength={60}
                  defaultValue={`My ${platform() === 'Browser' ? 'browser' : platform()}`}
                  autoComplete="off"
                />
              </label>
            )}
            {mode === 'create' ? (
              <>
                <label>
                  Workspace name
                  <input name="spaceName" required maxLength={60} defaultValue="My workspace" />
                </label>
                <label>
                  Local setup key
                  <input
                    name="key"
                    required
                    type="password"
                    placeholder="Paste your first-run setup key"
                    autoComplete="off"
                  />
                </label>
                <p className="field-hint">
                  The service writes this key to <code>.omnisync/bootstrap-key</code>. Open that
                  local file to finish setup. It is removed after use.
                </p>
              </>
            ) : mode === 'recover' ? (
              <>
                <label>
                  Local recovery key
                  <input name="key" type="password" required maxLength={128} autoComplete="off" />
                </label>
                <p className="field-hint">
                  On the service host, run <code>npm run recover-owner</code>, then open{' '}
                  <code>.omnisync/recovery-key</code>. The key expires after ten minutes. Recovery
                  signs out previous owner sessions and preserves workspace data.
                </p>
              </>
            ) : (
              <>
                <label>
                  Pairing code
                  <input
                    name="code"
                    className="code-input"
                    required
                    placeholder="A1B2C D3E4F"
                    maxLength={16}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                </label>
                <p className="field-hint">
                  On your connected device, select <strong>Add device</strong>. Codes expire after 5
                  minutes and work once.
                </p>
              </>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? 'Connecting…'
                : mode === 'create'
                  ? 'Create workspace'
                  : mode === 'recover'
                    ? 'Restore owner access'
                    : 'Join workspace'}
              <ArrowRight size={17} />
            </button>
          </form>
          {!initialized && (
            <button
              className="button-text mode-link"
              onClick={() => setMode(mode === 'create' ? 'join' : 'create')}
            >
              {mode === 'create' ? 'Have a pairing code? Join a space' : 'Set up a new workspace'}
            </button>
          )}
          {initialized && (
            <button
              className="button-text mode-link"
              onClick={() => setMode(mode === 'recover' ? 'join' : 'recover')}
            >
              {mode === 'recover' ? 'Join with a pairing code instead' : 'Recover owner access'}
            </button>
          )}
          <div className="onboarding-privacy">
            <ShieldCheck size={20} />
            <p>
              <strong>Your space stays yours.</strong>
              <br />
              Files stay on your local service. You decide which devices can access them.
            </p>
          </div>
          <div className="tiny-note">
            <LockKeyhole size={13} /> HTTPS is required for connections over your network.
          </div>
        </div>
      </section>
    </main>
  );
}
