import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Command,
  Copy,
  Download,
  FileCheck2,
  Files,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  Menu,
  MessageCircle,
  Monitor,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  StickyNote,
  Sun,
  Trash2,
  Upload,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, ago, bytes } from './api';
import {
  Badge,
  Brand,
  CopyButton,
  DeviceCard,
  DeviceIcon,
  Empty,
  FileIcon,
  Modal,
  SectionHeading,
  TextLink,
  Toggle,
  copyText,
} from './components';
import Onboarding from './Onboarding';
import Collaboration from './Collaboration';
import { useUploads } from './useUploads';
import { useScreen } from './useScreen';
import type { Capability, Clip, Device, Page, Permissions, State } from './types';

const navigation: { id: Page; label: string; icon: LucideIcon; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'devices', label: 'My devices', icon: MonitorSmartphone },
  { id: 'clipboard', label: 'Clipboard', icon: Clipboard },
  { id: 'transfers', label: 'File transfers', icon: Files },
  { id: 'screen', label: 'Screen sharing', icon: Monitor },
  { id: 'chat', label: 'Space chat', icon: MessageCircle, group: 'TOGETHER' },
  { id: 'collaboration', label: 'Collaboration', icon: StickyNote },
  { id: 'activity', label: 'Activity', icon: Activity },
];
const pageNames: Record<Page, string> = {
  overview: 'Overview',
  devices: 'My devices',
  clipboard: 'Clipboard',
  transfers: 'File transfers',
  screen: 'Screen sharing',
  chat: 'Space chat',
  activity: 'Activity',
  settings: 'Settings',
  collaboration: 'Collaboration',
};
const capabilities: { key: Capability; label: string; description: string; icon: LucideIcon }[] = [
  {
    key: 'clipboard',
    label: 'Clipboard',
    description: 'Send and read shared text and links',
    icon: Clipboard,
  },
  {
    key: 'files',
    label: 'File transfers',
    description: 'Upload and download shared files',
    icon: Files,
  },
  {
    key: 'chat',
    label: 'Chat & notes',
    description: 'Participate in workspace conversations',
    icon: MessageCircle,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Send and receive in-app device alerts',
    icon: Bell,
  },
  {
    key: 'screen',
    label: 'Screen sharing',
    description: 'Share or view screens with session consent',
    icon: Monitor,
  },
];

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [startupError, setStartupError] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [menu, setMenu] = useState(false);
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [modal, setModal] = useState<'invite' | 'search' | 'notifications' | 'note' | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');
  const [clipText, setClipText] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clipFilter, setClipFilter] = useState<'all' | 'pinned' | 'links'>('all');
  const [transferFilter, setTransferFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [dark, setDark] = useState(() => localStorage.getItem('omni-theme') === 'dark');
  const [notificationEnabled, setNotificationEnabled] = useState(
    () => localStorage.getItem('omni-notifications') === 'true',
  );
  const socket = useRef<WebSocket | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const seenNotifications = useRef(new Set<string>());
  const noticeSeeded = useRef(false);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const result = await api<State>('/state');
      setState(result);
      setInitialized(true);
      setStartupError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setState(null);
        setInitialized((await api('/bootstrap')).initialized);
      } else throw e;
    }
  }, []);
  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
    else throw new Error('The workspace is reconnecting. Try again in a moment.');
  }, []);
  const screens = useScreen(send, notify);
  const uploads = useUploads(state, refresh, notify);
  const screenHandler = useRef(screens.handle);
  screenHandler.current = screens.handle;
  const screenStop = useRef(screens.stop);
  screenStop.current = screens.stop;
  const meId = state?.me.id;
  useEffect(() => {
    refresh().catch((e) => setStartupError((e as Error).message));
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('omni-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (!meId) return;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let refreshTimer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    function connect() {
      clearTimeout(reconnect);
      if (
        disposed ||
        !navigator.onLine ||
        (socket.current && socket.current.readyState <= WebSocket.OPEN)
      )
        return;
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        refresh().catch(() => {});
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'state.changed') {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => refresh().catch(() => {}), 100);
        } else if (message.type === 'pong') setLatency(Math.max(1, Date.now() - message.ts));
        else if (message.type === 'error') {
          notify(message.error, true);
          screenStop.current(false);
        } else if (message.type === 'scratchpad.update')
          window.dispatchEvent(new CustomEvent('omni-realtime', { detail: message }));
        else screenHandler.current(message);
      };
      ws.onclose = (event) => {
        if (socket.current !== ws) return;
        setConnected(false);
        screenStop.current(false);
        if (event.code === 4001) {
          setState(null);
          setInitialized(true);
          notify('This device’s session ended. Pair again to reconnect.', true);
          return;
        }
        if (!disposed) reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
      };
      ws.onerror = () => ws.close();
    }
    const offline = () => {
      setConnected(false);
      socket.current?.close();
    };
    const online = () => connect();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    connect();
    const poll = setInterval(() => {
      refresh().catch(() => {});
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }, 15000);
    return () => {
      disposed = true;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      clearTimeout(reconnect);
      clearTimeout(refreshTimer);
      clearInterval(poll);
      socket.current?.close();
    };
  }, [meId, refresh, notify]);
  useEffect(() => {
    if (video.current) video.current.srcObject = screens.stream;
  }, [screens.stream, page]);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [state?.messages.length, page]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setModal((m) => (m === 'search' ? null : 'search'));
      }
      if (event.key === 'Escape') setMenu(false);
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Escape') {
        event.preventDefault();
        screenStop.current();
        api('/emergency-stop', 'POST', {}).catch(() => {});
        notify('Screen sessions stopped.');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!state) return;
    for (const notice of state.notifications) {
      if (
        noticeSeeded.current &&
        !seenNotifications.current.has(notice.id) &&
        notificationEnabled &&
        !state.focusMode &&
        !screens.session &&
        'Notification' in window &&
        Notification.permission === 'granted'
      )
        new Notification(notice.title, { body: notice.body, icon: '/icon.svg', tag: notice.id });
      seenNotifications.current.add(notice.id);
    }
    noticeSeeded.current = true;
  }, [state?.notifications, notificationEnabled, state?.focusMode, screens.session]);
  function go(next: Page) {
    setPage(next);
    setMenu(false);
    setQuery('');
  }
  async function act(path: string, method = 'POST', body?: unknown, success?: string) {
    try {
      const result = await api(path, method, body);
      await refresh();
      if (success) notify(success);
      return result;
    } catch (e) {
      notify((e as Error).message, true);
      return null;
    }
  }
  async function makeInvite(role = 'member') {
    setInviting(true);
    const result = await act('/invitations', 'POST', { role });
    setInviting(false);
    if (result) setInvite(result);
  }
  async function shareClip(event: FormEvent) {
    event.preventDefault();
    if (!clipText.trim()) return;
    setBusy(true);
    const result = await act(
      '/clipboard',
      'POST',
      { text: clipText, target: target || null },
      'Added to your shared clipboard.',
    );
    if (result) setClipText('');
    setBusy(false);
  }
  async function pasteClip() {
    try {
      setClipText(await navigator.clipboard.readText());
    } catch {
      notify('Clipboard access was not granted. Paste into the text box instead.', true);
    }
  }
  const toastElement = toast && (
    <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      {toast.error ? <Shield size={18} /> : <Check size={18} />}
      <span>{toast.text}</span>
      <button aria-label="Dismiss message" onClick={() => setToast(null)}>
        <X size={15} />
      </button>
    </div>
  );
  if (!state)
    return (
      <>
        {initialized !== null ? (
          <Onboarding initialized={initialized} onComplete={refresh} notify={notify} />
        ) : (
          <main className="loading">
            <Brand />
            {startupError ? (
              <>
                <h2>Let’s get you connected.</h2>
                <p>{startupError}</p>
                <button
                  className="button primary"
                  onClick={() => refresh().catch((e) => setStartupError(e.message))}
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <Loader2 className="spin" size={25} />
                <p>Opening your workspace…</p>
              </>
            )}
          </main>
        )}
        {toastElement}
      </>
    );
  const owner = state.me.role === 'owner';
  const readOnly = ['guest', 'observer'].includes(state.me.role);
  const shareSafe = screens.session?.role === 'sender';
  const nameOf = (id: string) => state.devices.find((d) => d.id === id)?.name || 'Former device';
  const currentDevice =
    selectedDevice && (state.devices.find((d) => d.id === selectedDevice.id) || selectedDevice);
  const online = state.devices.filter((d) => d.online).length;
  const ready = state.transfers.filter((t) => t.status === 'ready');
  const available = state.devices.filter((d) => d.id !== state.me.id && d.permissions.files);
  const visibleClips = state.clips.filter(
    (c) =>
      (!query || c.text.toLowerCase().includes(query.toLowerCase())) &&
      (clipFilter !== 'pinned' || c.pinned) &&
      (clipFilter !== 'links' || /^https?:\/\//.test(c.text)),
  );
  const chooseFile = () => fileInput.current?.click();
  const targetSelect = (
    <select aria-label="Send to device" value={target} onChange={(e) => setTarget(e.target.value)}>
      <option value="">Entire workspace</option>
      {available.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
  const clipComposer = (
    <form className="clip-composer" onSubmit={shareClip}>
      <textarea
        aria-label="Text to share"
        placeholder="A thought, a link, a little something to pick up elsewhere…"
        value={shareSafe ? '' : clipText}
        onChange={(e) => setClipText(e.target.value)}
        maxLength={32000}
        disabled={!state.me.permissions.clipboard || readOnly || shareSafe}
      />
      <div className="composer-footer">
        <button
          type="button"
          className="button-text"
          onClick={pasteClip}
          disabled={!state.me.permissions.clipboard || readOnly || shareSafe}
        >
          <Clipboard size={14} /> Paste from clipboard
        </button>
        <button
          className="button primary compact"
          disabled={
            busy || !clipText.trim() || !state.me.permissions.clipboard || readOnly || shareSafe
          }
        >
          Share <ArrowUpRight size={15} />
        </button>
      </div>
    </form>
  );
  function clipCard(clip: Clip) {
    return (
      <article className="clip-card" key={clip.id}>
        <div className="clip-card-meta">
          <span>
            <span className={`content-type ${/^https?:\/\//.test(clip.text) ? 'link' : ''}`}>
              {/^https?:\/\//.test(clip.text) ? <Link2 size={13} /> : <Clipboard size={13} />}
            </span>
            {/^https?:\/\//.test(clip.text) ? 'Link' : 'Text'}
            {clip.pinned ? <Pin size={12} /> : null}
          </span>
          <div>
            <CopyButton text={clip.text} onResult={notify} />
            {(clip.deviceId === state!.me.id || owner) && (
              <>
                <button
                  className={`icon-button ${clip.pinned ? 'active' : ''}`}
                  aria-label={clip.pinned ? 'Unpin item' : 'Pin item'}
                  onClick={() => act(`/clipboard/${clip.id}`, 'PATCH', { pinned: !clip.pinned })}
                >
                  <Pin size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Delete clipboard item"
                  onClick={() => act(`/clipboard/${clip.id}`, 'DELETE')}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
        <p className="clip-content">
          {shareSafe ? 'Clipboard content is hidden while you share your screen.' : clip.text}
        </p>
        <div className="clip-card-source">
          <span>
            {nameOf(clip.deviceId)}
            {clip.target ? ` → ${nameOf(clip.target)}` : ''}
          </span>
          <time>{ago(clip.createdAt)}</time>
        </div>
      </article>
    );
  }
  const pageHeading = (title: string, description: string, action?: React.ReactNode) => (
    <div className="page-heading">
      <div>
        <span className="eyebrow">YOUR CONNECTED WORKSPACE</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
  const activityList = (limit: number) => (
    <div className="activity-list">
      {state.activity.slice(0, limit).map((a) => (
        <div className="activity-item" key={a.id}>
          <span
            className={`activity-icon ${a.action.startsWith('file') ? 'peach' : a.action.startsWith('clipboard') ? 'lavender' : ''}`}
          >
            {a.action.startsWith('file') ? (
              <Files size={16} />
            ) : a.action.startsWith('clipboard') ? (
              <Clipboard size={16} />
            ) : a.action.includes('revoked') || a.action.includes('lockdown') ? (
              <Shield size={16} />
            ) : (
              <Link2 size={16} />
            )}
          </span>
          <div>
            <p>{a.detail}</p>
            <span>{a.action.replaceAll('.', ' · ')}</span>
          </div>
          <time>{ago(a.createdAt)}</time>
        </div>
      ))}
    </div>
  );
  return (
    <div className="app-shell">
      <input
        type="file"
        multiple
        ref={fileInput}
        hidden
        onChange={(e) => {
          if (e.target.files) uploads.add(e.target.files, target || null);
          e.target.value = '';
        }}
      />
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Brand />
        <button className="space-switcher" onClick={() => go('settings')}>
          <span className="space-avatar">{state.space.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{state.space.name}</strong>
            <small>Personal workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <div key={item.id}>
              {item.group && <span className="nav-label group-label">{item.group}</span>}
              <button
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => go(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
                {item.id === 'devices' && <span className="nav-count">{state.devices.length}</span>}
                {item.id === 'transfers' && uploads.uploads.length > 0 && (
                  <span className="nav-count">{uploads.uploads.length}</span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span>
              <ShieldCheck size={19} />
              <strong>Yours, by design.</strong>
            </span>
            <p>
              A local workspace.
              <br />
              No account. No cloud required.
            </p>
            <button className="text-link" onClick={() => go('settings')}>
              Privacy & permissions <ArrowUpRight size={13} />
            </button>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => go('settings')}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">{state.me.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{state.me.name}</strong>
              <small>{owner ? 'Workspace owner' : `${state.me.role} device`}</small>
            </span>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-indicator ${connected ? '' : 'disconnected'}`}>
              <span className="status-dot" />
              {connected ? 'Workspace connected' : 'Reconnecting…'}
            </span>
            <button
              className="search-trigger"
              onClick={() => setModal('search')}
              aria-label="Search workspace"
            >
              <Search size={17} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setModal('notifications')}
            >
              <Bell size={19} />
              {state.notifications.length > 0 && <i />}
            </button>
          </div>
        </header>
        {screens.session && page !== 'screen' && (
          <button className="session-banner" onClick={() => go('screen')}>
            <span className="pulse-dot" /> Screen session {screens.session.status} · Open screen
            sharing <ArrowRight size={16} />
          </button>
        )}
        <main className={`main-content page-${page}`}>
          {page === 'overview' && (
            <>
              {pageHeading(
                'Everything, in good company.',
                'Your devices. Your files. One place to keep things moving.',
                owner && (
                  <button
                    className="button primary"
                    onClick={() => {
                      setInvite(null);
                      setModal('invite');
                    }}
                  >
                    <Plus size={17} /> Add device
                  </button>
                ),
              )}
              <section className="hero-card">
                <div className="hero-copy">
                  <span className="eyebrow">
                    <span className="status-dot" /> A LITTLE LESS BACK AND FORTH
                  </span>
                  <h2>
                    From this device.
                    <br />
                    To your next idea.
                  </h2>
                  <p>
                    Drop a file. Share a thought. Pick it up anywhere.
                    <br />
                    Your workspace keeps the little things together.
                  </p>
                  <button
                    className="button hero-button"
                    onClick={chooseFile}
                    disabled={!state.me.permissions.files || readOnly}
                  >
                    Share a file <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-grid" />
                  <div className="art-orbit" />
                  <div className="art-laptop">
                    <div className="art-screen">
                      <span className="art-window-dots">•••</span>
                      <span className="art-file">
                        <FileCheck2 size={24} />
                        <span>All together.</span>
                        <span className="art-line" />
                      </span>
                      <span className="art-mini-row">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                    <div className="art-base" />
                  </div>
                  <div className="art-phone">
                    <div className="phone-notch" />
                    <span className="phone-check">
                      <Check size={24} />
                    </span>
                    <span>Right here.</span>
                    <div className="phone-line" />
                    <div className="phone-line short" />
                  </div>
                  <span className="art-float float-link">
                    <Link2 size={24} />
                  </span>
                  <span className="art-float float-check">
                    <CheckCheck size={18} /> In sync
                  </span>
                  <span className="art-star">✳</span>
                </div>
              </section>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-icon">
                    <MonitorSmartphone size={21} />
                  </span>
                  <div>
                    <span>Connected devices</span>
                    <strong>
                      {online}
                      <small> / {state.devices.length} paired</small>
                    </strong>
                  </div>
                  <span className="stat-tag">
                    <span className="status-dot" /> Live
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-icon peach">
                    <ArrowDownToLine size={21} />
                  </span>
                  <div>
                    <span>Files ready to share</span>
                    <strong>
                      {ready.length}
                      <small> {bytes(ready.reduce((n, t) => n + t.size, 0))} total</small>
                    </strong>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon lavender">
                    <Clipboard size={21} />
                  </span>
                  <div>
                    <span>Shared clipboard</span>
                    <strong>
                      {state.clips.length}
                      <small> items, always handy</small>
                    </strong>
                  </div>
                </div>
              </div>
              <section>
                <SectionHeading
                  title="Your devices"
                  detail="A familiar place on every screen."
                  action={<TextLink onClick={() => go('devices')}>Manage devices</TextLink>}
                />
                <div className="device-grid overview-devices">
                  {state.devices.slice(0, 3).map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      me={state.me.id}
                      onClick={() => setSelectedDevice(device)}
                    />
                  ))}
                  {state.devices.length < 3 && (
                    <button
                      className="add-device-card"
                      onClick={() =>
                        owner
                          ? (setInvite(null), setModal('invite'))
                          : notify('Ask the workspace owner for a pairing code.')
                      }
                    >
                      <span>
                        <Plus size={22} />
                      </span>
                      <strong>One more, all together.</strong>
                      <p>Connect your phone, laptop, or tablet.</p>
                      <span className="text-link">
                        Pair a device <ArrowUpRight size={14} />
                      </span>
                    </button>
                  )}
                </div>
              </section>
              <div className="overview-columns">
                <section className="panel quick-drop">
                  <SectionHeading
                    title="A place to drop things"
                    action={<Badge>TOP SHELF</Badge>}
                  />
                  <div
                    className={`drop-zone ${dragging ? 'dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      uploads.add(e.dataTransfer.files, target || null);
                    }}
                  >
                    <span className="drop-icon">
                      <Upload size={24} />
                    </span>
                    <h3>Drop it here. Get it there.</h3>
                    <p>Files, photos, and the things you’re working on.</p>
                    <button
                      className="button secondary compact"
                      onClick={chooseFile}
                      disabled={!state.me.permissions.files || readOnly}
                    >
                      Browse files <Plus size={14} />
                    </button>
                    <small>
                      Up to {bytes(state.limits.maxFileSize)} per file · SHA-256 verified
                    </small>
                  </div>
                  <div className="drop-target">
                    <span>
                      <Send size={14} /> Send to
                    </span>
                    {targetSelect}
                  </div>
                </section>
                <section className="panel">
                  <SectionHeading
                    title="Your shared clipboard"
                    action={<TextLink onClick={() => go('clipboard')}>See all</TextLink>}
                  />
                  {clipComposer}
                  {state.clips[0] ? (
                    <div className="recent-clip">{clipCard(state.clips[0])}</div>
                  ) : (
                    <div className="clipboard-tip">
                      <Sparkles size={18} />
                      <p>
                        A useful link, a quick note, a spark of an idea.
                        <br />
                        Share your first snippet to keep it within reach.
                      </p>
                    </div>
                  )}
                </section>
              </div>
              <section className="panel activity-panel">
                <SectionHeading
                  title="A little workspace activity"
                  action={<TextLink onClick={() => go('activity')}>View activity</TextLink>}
                />
                {activityList(3)}
              </section>
              <footer className="workspace-footer">
                <span>
                  <ShieldCheck size={14} /> Local-first. Intentionally simple.
                </span>
                <span>Made for the way you move.</span>
              </footer>
            </>
          )}
          {page === 'devices' && (
            <>
              {pageHeading(
                'Your everyday, connected.',
                'Manage the devices you trust and what they can share.',
                owner && (
                  <button
                    className="button primary"
                    onClick={() => {
                      setInvite(null);
                      setModal('invite');
                    }}
                  >
                    <Plus size={17} /> Add device
                  </button>
                ),
              )}
              <div className="info-strip">
                <Wifi size={19} />
                <div>
                  <strong>
                    {online} {online === 1 ? 'device' : 'devices'} connected to this workspace
                  </strong>
                  <span>
                    Presence updates live. Devices reconnect automatically when this app reopens.
                  </span>
                </div>
                <Badge>{latency ? `${latency} ms to service` : 'Connecting'}</Badge>
              </div>
              <div className="device-grid">
                {state.devices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    me={state.me.id}
                    onClick={() => setSelectedDevice(device)}
                  />
                ))}
              </div>
              <div className="info-card">
                <ShieldCheck size={28} />
                <div>
                  <h3>A connection is a choice.</h3>
                  <p>
                    New devices receive files and clipboard access. Screen sharing stays off until
                    the owner enables it, and every session asks the viewer to accept.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === 'clipboard' && (
            <>
              {pageHeading(
                'Good ideas travel light.',
                'Text, links, and little things — ready on your next device.',
              )}
              <div className="clipboard-layout">
                <div>
                  <div className="filter-bar">
                    <div className="tabs">
                      {(['all', 'pinned', 'links'] as const).map((f) => (
                        <button
                          key={f}
                          className={clipFilter === f ? 'active' : ''}
                          onClick={() => setClipFilter(f)}
                        >
                          {f === 'all' ? 'All items' : f === 'pinned' ? 'Pinned' : 'Links'}
                        </button>
                      ))}
                    </div>
                    <div className="inline-search">
                      <Search size={16} />
                      <input
                        aria-label="Search clipboard"
                        placeholder="Find a snippet…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  {visibleClips.length ? (
                    <div className="clip-grid">{visibleClips.map(clipCard)}</div>
                  ) : (
                    <Empty
                      icon={Clipboard}
                      title={
                        query || clipFilter !== 'all'
                          ? 'No matching snippets'
                          : 'Your next idea starts here'
                      }
                      text={
                        state.me.permissions.clipboard
                          ? 'Share a note or link to make it available across your connected devices.'
                          : 'Clipboard access is disabled. Ask the owner to enable it.'
                      }
                    />
                  )}
                </div>
                <aside className="panel compose-panel">
                  <SectionHeading title="Share a snippet" />
                  {clipComposer}
                  <div className="drop-target">
                    <span>Send to</span>
                    {targetSelect}
                  </div>
                  <p className="field-hint">
                    <LockKeyhole size={13} /> Only share content you’re comfortable storing on this
                    service. Passwords and secrets are best kept in your password manager.
                  </p>
                  <div className="retention-note">
                    <span>
                      <Activity size={15} /> Room to think
                    </span>
                    <p>
                      Unpinned items clear after {state.space.retentionDays} days. Pin what you want
                      to keep.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === 'transfers' && (
            <>
              {pageHeading(
                'Send it on its way.',
                'Verified files, resumable uploads, and a little less emailing yourself.',
                <button
                  className="button primary"
                  onClick={chooseFile}
                  disabled={!state.me.permissions.files || readOnly}
                >
                  <Plus size={17} /> Send files
                </button>,
              )}
              <div className="transfer-top">
                <div className="drop-target">
                  <span>New transfers go to</span>
                  {targetSelect}
                </div>
                <span className="muted">
                  <HardDrive size={15} /> {bytes(state.limits.usedStorage)} of{' '}
                  {bytes(state.limits.maxStorage)} used
                </span>
              </div>
              {uploads.uploads.length > 0 && (
                <section className="panel upload-panel">
                  <SectionHeading title="On the move" />
                  {uploads.uploads.map((u) => (
                    <div className="upload-row" key={u.id}>
                      <FileIcon name={u.name} />
                      <div className="upload-detail">
                        <strong>{u.name}</strong>
                        <p>
                          {u.status === 'hashing'
                            ? 'Calculating checksum…'
                            : u.status === 'error'
                              ? u.error
                              : `${u.status === 'paused' ? 'Paused' : 'Uploading'} · ${Math.min(100, Math.round(u.progress))}%`}
                        </p>
                        <progress max="100" value={u.progress} />
                      </div>
                      {u.status === 'uploading' ? (
                        <button
                          className="icon-button"
                          aria-label={`Pause ${u.name}`}
                          onClick={() => uploads.pause(u.id)}
                        >
                          <Pause size={17} />
                        </button>
                      ) : u.status !== 'hashing' ? (
                        <button
                          className="icon-button"
                          aria-label={`Resume ${u.name}`}
                          onClick={() => uploads.resume(u.id)}
                        >
                          <Play size={17} />
                        </button>
                      ) : null}
                      <button
                        className="icon-button"
                        aria-label={`Remove ${u.name}`}
                        onClick={() => uploads.cancel(u.id)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <div className="filter-bar">
                <div className="tabs">
                  {(['all', 'sent', 'received'] as const).map((f) => (
                    <button
                      key={f}
                      className={transferFilter === f ? 'active' : ''}
                      onClick={() => setTransferFilter(f)}
                    >
                      {f === 'all' ? 'All files' : f === 'sent' ? 'Sent by me' : 'Received'}
                    </button>
                  ))}
                </div>
                <Badge>
                  <ShieldCheck size={12} /> Integrity checked
                </Badge>
              </div>
              <div className="panel transfer-table">
                {state.transfers.filter(
                  (t) =>
                    transferFilter === 'all' ||
                    (transferFilter === 'sent'
                      ? t.deviceId === state.me.id
                      : t.deviceId !== state.me.id),
                ).length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>From / to</th>
                        <th>Status</th>
                        <th>Added</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.transfers
                        .filter(
                          (t) =>
                            transferFilter === 'all' ||
                            (transferFilter === 'sent'
                              ? t.deviceId === state.me.id
                              : t.deviceId !== state.me.id),
                        )
                        .map((t) => (
                          <tr key={t.id}>
                            <td>
                              <div className="file-cell">
                                <FileIcon name={t.name} />
                                <div>
                                  <strong>{t.name}</strong>
                                  <small>{bytes(t.size)}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span>{nameOf(t.deviceId)}</span>
                              <small>→ {t.target ? nameOf(t.target) : 'Entire workspace'}</small>
                            </td>
                            <td>
                              <Badge tone={t.status === 'ready' ? 'green' : 'amber'}>
                                {t.status === 'ready' ? (
                                  <>
                                    <Check size={12} /> Ready
                                  </>
                                ) : (
                                  `${Math.round((t.offset / (t.size || 1)) * 100)}% uploaded`
                                )}
                              </Badge>
                            </td>
                            <td>
                              <span className="muted">{ago(t.createdAt)}</span>
                            </td>
                            <td>
                              <div className="row-actions">
                                {t.status === 'ready' ? (
                                  <a
                                    className="icon-button"
                                    href={`/api/transfers/${t.id}/download`}
                                    aria-label={`Download ${t.name}`}
                                  >
                                    <Download size={17} />
                                  </a>
                                ) : t.deviceId === state.me.id ? (
                                  <button
                                    className="icon-button"
                                    aria-label="Reselect file to resume"
                                    title="Select the same file to resume"
                                    onClick={chooseFile}
                                  >
                                    <Play size={17} />
                                  </button>
                                ) : null}
                                {(t.deviceId === state.me.id || owner) && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Delete ${t.name}`}
                                    onClick={() => {
                                      if (window.confirm(`Delete ${t.name} from this workspace?`))
                                        act(`/transfers/${t.id}`, 'DELETE');
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty
                    icon={FolderOpen}
                    title="A clean slate for your files"
                    text="Drop a file on the overview or choose Send files. Other paired devices can download it here."
                    action={
                      <button
                        className="button secondary"
                        onClick={chooseFile}
                        disabled={!state.me.permissions.files || readOnly}
                      >
                        Choose a file <Plus size={15} />
                      </button>
                    }
                  />
                )}
              </div>
              <p className="footnote">
                Uploads resume after interruption: select the same file and recipient again. Files
                stay on the service until the sender or owner deletes them.
              </p>
            </>
          )}
          {page === 'screen' && (
            <>
              {pageHeading(
                'A shared point of view.',
                'Share a screen or window, with a clear invitation and an easy way to stop.',
              )}
              <div className="screen-layout">
                <section className={`screen-stage ${screens.stream ? 'has-stream' : ''}`}>
                  {screens.stream ? (
                    <>
                      <video ref={video} autoPlay playsInline muted aria-label="Shared screen" />
                      <div className="screen-controls">
                        <span>
                          <span className="pulse-dot" />
                          {screens.session?.role === 'viewer' ? 'Viewing' : 'Sharing'} ·{' '}
                          {screens.session?.status || 'Inviting viewer'}
                        </span>
                        <button className="button danger compact" onClick={() => screens.stop()}>
                          <Square size={13} /> Stop session
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Full screen"
                          onClick={() => video.current?.requestFullscreen()}
                        >
                          <Monitor size={17} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={Monitor}
                      title="See what’s on the other side."
                      text="Choose an online device, pick the screen you want to share, and wait for your viewer to accept."
                    />
                  )}
                </section>
                <aside className="panel">
                  <SectionHeading
                    title="Share with a device"
                    detail="Only devices with screen permission appear."
                  />
                  {state.devices
                    .filter((d) => d.id !== state.me.id && d.permissions.screen)
                    .map((d) => (
                      <div className="screen-device" key={d.id}>
                        <DeviceIcon platform={d.platform} />
                        <div>
                          <strong>{d.name}</strong>
                          <small>{d.online ? 'Online' : 'Offline'}</small>
                        </div>
                        <button
                          className="button secondary compact"
                          onClick={() => screens.start(d.id)}
                          disabled={
                            readOnly ||
                            !d.online ||
                            !state.me.permissions.screen ||
                            Boolean(screens.session) ||
                            Boolean(screens.stream) ||
                            !connected
                          }
                        >
                          Share
                        </button>
                      </div>
                    ))}
                  {!state.devices.some((d) => d.id !== state.me.id && d.permissions.screen) && (
                    <p className="field-hint">
                      Pair another device, then enable its screen-sharing permission in My devices.
                    </p>
                  )}
                  <div className="retention-note">
                    <span>
                      <ShieldCheck size={17} /> You’re in control
                    </span>
                    <p>
                      Your browser asks what to share. Your viewer must accept. Stop anytime here or
                      from your browser’s sharing indicator.
                    </p>
                  </div>
                </aside>
              </div>
              <div className="info-card">
                <MonitorSmartphone size={26} />
                <div>
                  <h3>Made for a shared network</h3>
                  <p>
                    This release uses direct WebRTC screen video on your LAN or overlay network.
                    Remote OS control, system audio, internet TURN relays, and virtual second
                    displays require future native integrations.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === 'chat' && (
            <>
              {pageHeading(
                'A little space to think together.',
                'Conversations and shared notes, right where your devices meet.',
                <button
                  className="button secondary"
                  disabled={!state.me.permissions.chat || readOnly}
                  onClick={() => setModal('note')}
                >
                  <Plus size={17} /> Add note
                </button>,
              )}
              <div className="chat-layout">
                <section className="panel chat-panel">
                  <div className="chat-header">
                    <span className="chat-symbol">
                      <MessageCircle size={19} />
                    </span>
                    <div>
                      <strong>{state.space.name}</strong>
                      <small>{online} online · Shared conversation</small>
                    </div>
                    <span className="status-dot" />
                  </div>
                  <div className="chat-messages">
                    {state.messages.length ? (
                      state.messages.map((m) => (
                        <div
                          className={`message ${m.deviceId === state.me.id ? 'mine' : ''}`}
                          key={m.id}
                        >
                          <span className="message-avatar">
                            {nameOf(m.deviceId).slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <span className="message-meta">
                              {nameOf(m.deviceId)}
                              <time>
                                {new Date(m.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                            </span>
                            <p>{m.text}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <Empty
                        icon={MessageCircle}
                        title="Say something, start something."
                        text="Messages appear in real time on every device with chat access."
                      />
                    )}
                    <div ref={chatBottom} />
                  </div>
                  <form
                    className="chat-compose"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const text = new FormData(form).get('message');
                      setBusy(true);
                      const result = await act('/messages', 'POST', { text });
                      if (result) form.reset();
                      setBusy(false);
                    }}
                  >
                    <input
                      name="message"
                      aria-label="Message"
                      placeholder="A message for your workspace…"
                      required
                      maxLength={4000}
                      autoComplete="off"
                      disabled={!state.me.permissions.chat || readOnly}
                    />
                    <button
                      className="button primary"
                      aria-label="Send message"
                      disabled={busy || !state.me.permissions.chat || readOnly}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </section>
                <aside>
                  <SectionHeading title="On the board" detail="Small notes. Shared headspace." />
                  {state.notes.length ? (
                    state.notes.map((note) => (
                      <article className={`sticky-note ${note.color}`} key={note.id}>
                        <span>
                          <StickyNote size={15} />
                          {(note.deviceId === state.me.id || owner) && (
                            <button
                              className="icon-button"
                              aria-label="Delete note"
                              onClick={() => act(`/notes/${note.id}`, 'DELETE')}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </span>
                        <p>{note.text}</p>
                        <small>
                          {nameOf(note.deviceId)} · {ago(note.createdAt)}
                        </small>
                      </article>
                    ))
                  ) : (
                    <button
                      className="note-placeholder"
                      onClick={() => setModal('note')}
                      disabled={!state.me.permissions.chat || readOnly}
                    >
                      <Plus size={23} />
                      <span>Keep a thought here.</span>
                    </button>
                  )}
                </aside>
              </div>
            </>
          )}
          {page === 'collaboration' && (
            <Collaboration
              state={state}
              connected={connected}
              notify={notify}
              send={send}
              onSendFile={(recipient) => {
                setTarget(recipient);
                chooseFile();
              }}
            />
          )}
          {page === 'activity' && (
            <>
              {pageHeading(
                'The little things, logged.',
                'A local record of connections, permissions, and shared moments.',
                owner && (
                  <button
                    className="button secondary"
                    onClick={async () => {
                      const result = await act('/audit/verify', 'GET');
                      if (result)
                        notify(
                          result.valid
                            ? `Verified the chain of ${result.count} activity records.`
                            : 'The activity log integrity check failed.',
                          !result.valid,
                        );
                    }}
                  >
                    <ShieldCheck size={17} /> Verify log
                  </button>
                ),
              )}
              <section className="panel">{activityList(60)}</section>
              <p className="footnote">
                Records form a SHA-256 hash chain. This can reveal accidental or partial changes; it
                does not protect against a server administrator rewriting the whole database.
              </p>
            </>
          )}
          {page === 'settings' && (
            <>
              {pageHeading(
                'A workspace that feels like you.',
                'Make it comfortable. Keep it under your control.',
              )}
              <div className="settings-grid">
                <section className="panel">
                  <SectionHeading
                    title="Your workspace"
                    detail="A name and a little room for fresh ideas."
                  />
                  <form
                    className="settings-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      await act(
                        '/settings',
                        'PATCH',
                        { name: form.get('name'), retentionDays: Number(form.get('retention')) },
                        'Workspace settings saved.',
                      );
                    }}
                  >
                    <label>
                      Workspace name
                      <input
                        name="name"
                        defaultValue={state.space.name}
                        required
                        maxLength={60}
                        disabled={!owner}
                      />
                    </label>
                    <label>
                      Keep unpinned clipboard items
                      <select
                        name="retention"
                        defaultValue={state.space.retentionDays}
                        disabled={!owner}
                      >
                        <option value="1">1 day</option>
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                      </select>
                    </label>
                    {owner && (
                      <button className="button primary">
                        Save changes <Check size={16} />
                      </button>
                    )}
                  </form>
                </section>
                <section className="panel">
                  <SectionHeading
                    title="Make yourself at home"
                    detail="Preferences for this browser."
                  />
                  <div className="setting-row">
                    <span className="setting-icon">
                      {dark ? <Moon size={20} /> : <Sun size={20} />}
                    </span>
                    <div>
                      <strong>Dark appearance</strong>
                      <p>A little softer after hours.</p>
                    </div>
                    <Toggle checked={dark} onChange={setDark} label="Dark appearance" />
                  </div>
                  <div className="setting-row">
                    <span className="setting-icon">
                      <Bell size={20} />
                    </span>
                    <div>
                      <strong>Browser notifications</strong>
                      <p>Show incoming workspace alerts.</p>
                    </div>
                    <Toggle
                      checked={notificationEnabled}
                      label="Browser notifications"
                      onChange={async (enabled) => {
                        if (
                          enabled &&
                          (!('Notification' in window) ||
                            (await Notification.requestPermission()) !== 'granted')
                        ) {
                          notify('Notification permission was not granted.', true);
                          return;
                        }
                        setNotificationEnabled(enabled);
                        localStorage.setItem('omni-notifications', String(enabled));
                      }}
                    />
                  </div>
                  <div className="setting-row">
                    <span className="setting-icon">
                      <DeviceIcon platform={state.me.platform} />
                    </span>
                    <div>
                      <strong>{state.me.name}</strong>
                      <p>This browser’s device identity.</p>
                    </div>
                    <button className="button-text" onClick={() => setSelectedDevice(state.me)}>
                      Edit <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <SectionHeading title="Privacy & connection" />
                  <div className="diagnostic">
                    <span>Transport</span>
                    <Badge tone={state.transport.secure ? 'green' : 'amber'}>
                      {state.transport.secure ? 'HTTPS enabled' : 'Localhost HTTP'}
                    </Badge>
                  </div>
                  <div className="diagnostic">
                    <span>Storage</span>
                    <strong>Local service · SQLite + files</strong>
                  </div>
                  <div className="diagnostic">
                    <span>Encryption at rest / E2E</span>
                    <strong>Not included in this release</strong>
                  </div>
                  <div className="diagnostic">
                    <span>Clipboard & screen API</span>
                    <Badge tone={window.isSecureContext ? 'green' : 'amber'}>
                      {window.isSecureContext ? 'Secure context' : 'HTTPS required'}
                    </Badge>
                  </div>
                  <p className="field-hint">
                    The service administrator can access stored content. Use a trusted host and disk
                    encryption. Pair only trusted browsers; pairing grants the selected access to
                    this workspace.
                  </p>
                </section>
                <section className="panel">
                  <SectionHeading title="One button. A fresh boundary." />
                  <div className="lockdown-info">
                    <Shield size={27} />
                    <p>
                      Lockdown revokes every other device, cancels invitations, and stops screen
                      sessions. Your owner device keeps access so you can pair trusted devices
                      again.
                    </p>
                  </div>
                  <button
                    className="button danger"
                    disabled={!owner}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Revoke all other devices and stop every screen session? Devices must pair again.',
                        )
                      )
                        act(
                          '/lockdown',
                          'POST',
                          {},
                          'Workspace locked down. Only your owner device retains access.',
                        );
                    }}
                  >
                    <LockKeyhole size={16} /> Lock down workspace
                  </button>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
      {uploads.uploads.length > 0 && page !== 'transfers' && (
        <button className="upload-tray" onClick={() => go('transfers')}>
          <Upload size={18} />
          <span>
            {uploads.uploads.length} file{uploads.uploads.length === 1 ? '' : 's'} in your queue
          </span>
          <ArrowRight size={16} />
        </button>
      )}
      {modal === 'invite' && (
        <Modal title="Bring another device along" onClose={() => setModal(null)}>
          <p className="modal-description">
            Open this workspace’s address on another device and enter a single-use pairing code. For
            another physical device, use your configured HTTPS address.
          </p>
          <div className="invite-address">
            <span>Workspace address</span>
            <code>{location.origin}</code>
            <CopyButton text={location.origin} onResult={notify} label="Copy workspace address" />
          </div>
          {invite ? (
            <div className="invite-code">
              <span>YOUR PAIRING CODE</span>
              <strong>
                {invite.code.slice(0, 5)} {invite.code.slice(5)}
              </strong>
              <p>
                Expires at{' '}
                {new Date(invite.expiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · One use only
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  copyText(invite.code)
                    .then(() => notify('Pairing code copied.'))
                    .catch((e) => notify(e.message, true))
                }
              >
                <Copy size={16} /> Copy code
              </button>
            </div>
          ) : (
            <div className="invite-options">
              <button
                className="invite-option"
                disabled={inviting}
                onClick={() => makeInvite('member')}
              >
                <span className="form-mark">
                  <MonitorSmartphone size={23} />
                </span>
                <div>
                  <strong>My device or a trusted member</strong>
                  <p>Files, clipboard, chat, and notifications</p>
                </div>
                <ArrowRight size={18} />
              </button>
              <button
                className="invite-option"
                disabled={inviting}
                onClick={() => makeInvite('guest')}
              >
                <span className="form-mark lavender">
                  <Link2 size={23} />
                </span>
                <div>
                  <strong>A guest device</strong>
                  <p>Read-only files, chat, and invited screen viewing</p>
                </div>
                <ArrowRight size={18} />
              </button>
              <button
                className="invite-option"
                disabled={inviting}
                onClick={() => makeInvite('observer')}
              >
                <span className="form-mark">
                  <Monitor size={23} />
                </span>
                <div>
                  <strong>A read-only observer</strong>
                  <p>Watch, read, and download. No edits or uploads.</p>
                </div>
                <ArrowRight size={18} />
              </button>
            </div>
          )}
          <p className="field-hint">
            <ShieldCheck size={15} /> Members start with screen access off. Guests and observers can
            accept screen invitations but cannot present or edit content.
          </p>
        </Modal>
      )}
      {currentDevice && (
        <Modal title="Device details" onClose={() => setSelectedDevice(null)}>
          <div className="device-modal-title">
            <span className="device-symbol">
              <DeviceIcon platform={currentDevice.platform} size={32} />
            </span>
            <div>
              <h3>{currentDevice.name}</h3>
              <p>
                {currentDevice.platform} · {currentDevice.role} ·{' '}
                {currentDevice.online ? 'Connected' : `Last seen ${ago(currentDevice.lastSeen)}`}
              </p>
            </div>
          </div>
          {(owner || currentDevice.id === state.me.id) && (
            <form
              className="rename-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(
                  `/devices/${currentDevice.id}`,
                  'PATCH',
                  { name: new FormData(e.currentTarget).get('name') },
                  'Device name updated.',
                );
              }}
            >
              <input
                name="name"
                aria-label="Device name"
                defaultValue={currentDevice.name}
                key={currentDevice.id}
                required
                maxLength={60}
              />
              <button className="button secondary">Rename</button>
            </form>
          )}
          <h4 className="small-heading">DEVICE PERMISSIONS</h4>
          {capabilities.map((cap) => (
            <div className="setting-row" key={cap.key}>
              <span className="setting-icon">
                <cap.icon size={18} />
              </span>
              <div>
                <strong>{cap.label}</strong>
                <p>{cap.description}</p>
              </div>
              <Toggle
                label={`${cap.label} permission`}
                disabled={!owner || currentDevice.role === 'owner'}
                checked={currentDevice.permissions[cap.key]}
                onChange={(enabled) =>
                  act(`/devices/${currentDevice.id}`, 'PATCH', {
                    permissions: { ...currentDevice.permissions, [cap.key]: enabled },
                  })
                }
              />
            </div>
          ))}
          {currentDevice.id !== state.me.id &&
            state.me.permissions.notifications &&
            currentDevice.permissions.notifications && (
              <button
                className="button secondary full"
                onClick={() =>
                  act(
                    '/notifications',
                    'POST',
                    {
                      target: currentDevice.id,
                      title: 'A little hello from OmniSync',
                      body: `${state.me.name} sent you a connection check.`,
                    },
                    'Sent a notification to this device.',
                  )
                }
              >
                <Bell size={16} /> Send a test notification
              </button>
            )}
          {owner && currentDevice.role !== 'owner' && (
            <button
              className="button-text destructive revoke-button"
              onClick={async () => {
                if (
                  window.confirm(
                    `Revoke ${currentDevice.name}? It will need a new pairing code to reconnect.`,
                  )
                ) {
                  const result = await act(
                    `/devices/${currentDevice.id}`,
                    'DELETE',
                    undefined,
                    'Device access revoked.',
                  );
                  if (result) setSelectedDevice(null);
                }
              }}
            >
              <Trash2 size={15} /> Revoke device access
            </button>
          )}
        </Modal>
      )}
      {modal === 'search' && (
        <Modal
          title="Find your flow"
          onClose={() => {
            setModal(null);
            setQuery('');
          }}
        >
          <div className="command-search">
            <Search size={20} />
            <input
              autoFocus
              placeholder="Search pages, devices, or clipboard…"
              aria-label="Search workspace content"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            {navigation
              .filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    go(n.id);
                    setModal(null);
                  }}
                >
                  <n.icon size={18} />
                  <span>{n.label}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {query &&
              state.devices
                .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
                .map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setModal(null);
                      setSelectedDevice(d);
                    }}
                  >
                    <DeviceIcon platform={d.platform} size={18} />
                    <span>{d.name}</span>
                    <Badge>Device</Badge>
                  </button>
                ))}
            {query &&
              state.clips
                .filter((c) => c.text.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 5)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setPage('clipboard');
                      setModal(null);
                    }}
                  >
                    <Clipboard size={18} />
                    <span>{c.text.slice(0, 70)}</span>
                    <Badge>Clipboard</Badge>
                  </button>
                ))}
            {query &&
              state.transfers
                .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 5)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      go('transfers');
                      setModal(null);
                    }}
                  >
                    <Files size={18} />
                    <span>{t.name}</span>
                    <Badge>File</Badge>
                  </button>
                ))}
            {query &&
              [...state.messages, ...state.notes]
                .filter((m) => m.text.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 5)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      go('chat');
                      setModal(null);
                    }}
                  >
                    <MessageCircle size={18} />
                    <span>{m.text.slice(0, 70)}</span>
                    <Badge>Chat / note</Badge>
                  </button>
                ))}
          </div>
        </Modal>
      )}
      {modal === 'notifications' && (
        <Modal title="A little heads-up" onClose={() => setModal(null)}>
          {state.notifications.length ? (
            state.notifications.map((n) => (
              <article className="notification-card" key={n.id}>
                <Bell size={19} />
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <small>
                    {nameOf(n.deviceId)} · {ago(n.createdAt)}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label="Dismiss notification"
                  onClick={() => act(`/notifications/${n.id}`, 'DELETE')}
                >
                  <X size={16} />
                </button>
              </article>
            ))
          ) : (
            <Empty
              icon={Bell}
              title="All caught up."
              text="Notifications from your paired devices will appear here."
            />
          )}
        </Modal>
      )}
      {modal === 'note' && (
        <Modal title="Keep a thought on the board" onClose={() => setModal(null)}>
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await act('/notes', 'POST', {
                text: form.get('text'),
                color: form.get('color'),
              });
              if (result) setModal(null);
            }}
          >
            <label>
              Your note
              <textarea
                name="text"
                required
                maxLength={1000}
                rows={5}
                placeholder="A reminder, a plan, a small bright idea…"
                autoFocus
              />
            </label>
            <label>
              Note color
              <select name="color">
                <option value="sage">Sage green</option>
                <option value="peach">Soft peach</option>
                <option value="lavender">Lavender</option>
              </select>
            </label>
            <button className="button primary" disabled={!state.me.permissions.chat || readOnly}>
              Add to board <Plus size={16} />
            </button>
          </form>
        </Modal>
      )}
      {screens.incoming && (
        <Modal title="A screen-sharing invitation" onClose={screens.decline}>
          <div className="screen-invitation">
            <Monitor size={38} />
            <h3>{nameOf(screens.incoming.from)} wants to share a screen with you.</h3>
            <p>This is view-only. Your own screen, keyboard, and mouse stay private.</p>
            <div>
              <button className="button secondary" onClick={screens.decline}>
                Decline
              </button>
              <button
                className="button primary"
                onClick={() => {
                  screens.accept();
                  go('screen');
                }}
              >
                Accept & view <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toastElement}
    </div>
  );
}
