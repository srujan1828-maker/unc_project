import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  Check,
  Download,
  FileQuestion,
  Focus,
  Plus,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import { api, ago } from './api';
import { Badge, Empty, Modal, SectionHeading } from './components';
import type { State } from './types';

type Task = {
  id: string;
  text: string;
  deviceId: string;
  assignee: string | null;
  due: string | null;
  status: 'todo' | 'doing' | 'done';
  version: number;
};
type Request = {
  id: string;
  text: string;
  deviceId: string;
  target: string;
  status: 'pending' | 'declined' | 'fulfilled';
  createdAt: number;
};
type Data = {
  scratchpad: string | null;
  tasks: Task[];
  requests: Request[];
  presence: { deviceId: string; status: string }[];
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export default function Collaboration({
  state,
  connected,
  notify,
  send,
  onSendFile,
}: {
  state: State;
  connected: boolean;
  notify: (text: string, error?: boolean) => void;
  send: (data: object) => void;
  onSendFile: (target: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [scratch, setScratch] = useState('');
  const [modal, setModal] = useState<'task' | 'request' | null>(null);
  const doc = useRef<Y.Doc | null>(null);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const canWrite = !['guest', 'observer'].includes(state.me.role);
  const canEdit = state.me.permissions.chat && canWrite;
  const nameOf = (id: string | null) =>
    state.devices.find((d) => d.id === id)?.name || 'Unassigned';
  async function refresh() {
    try {
      setData(await api<Data>('/collaboration'));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  useEffect(() => {
    refresh();
  }, [state]);
  useEffect(() => {
    if (!state.me.permissions.chat) return;
    const ydoc = new Y.Doc();
    doc.current = ydoc;
    const persistence = new IndexeddbPersistence(
      `omnisync-scratchpad-${location.origin}-${state.me.id}`,
      ydoc,
    );
    const ytext = ydoc.getText('scratchpad');
    ytext.observe(() => setScratch(ytext.toString()));
    let updateTimer: ReturnType<typeof setTimeout>;
    let pending: Uint8Array[] = [];
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && canEdit && connectedRef.current) {
        pending.push(update);
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
          const merged = Y.mergeUpdates(pending);
          pending = [];
          try {
            send({ type: 'scratchpad.update', update: encode(merged) });
          } catch {
            /* Persisted locally; merged on reconnect. */
          }
        }, 180);
      }
    });
    function remote(event: Event) {
      const message = (event as CustomEvent).detail;
      if (message.type === 'scratchpad.update')
        Y.applyUpdate(ydoc, decode(message.update), 'remote');
    }
    window.addEventListener('omni-realtime', remote);
    persistence.whenSynced
      .then(async () => {
        const snapshot = await api<Data>('/collaboration');
        if (doc.current !== ydoc) return;
        if (snapshot.scratchpad) Y.applyUpdate(ydoc, decode(snapshot.scratchpad), 'remote');
        if (canEdit && connectedRef.current)
          send({ type: 'scratchpad.update', update: encode(Y.encodeStateAsUpdate(ydoc)) });
      })
      .catch((e) => notify(e.message, true));
    return () => {
      clearTimeout(updateTimer);
      window.removeEventListener('omni-realtime', remote);
      doc.current = null;
      persistence.destroy();
      ydoc.destroy();
    };
  }, [state.me.id, state.me.permissions.chat, canEdit]);
  useEffect(() => {
    if (connected && doc.current && canEdit) {
      try {
        send({ type: 'scratchpad.update', update: encode(Y.encodeStateAsUpdate(doc.current)) });
      } catch {
        /* A subsequent reconnect retries. */
      }
    }
  }, [connected]);
  function edit(value: string) {
    const ydoc = doc.current;
    if (!ydoc || !canEdit) return;
    const ytext = ydoc.getText('scratchpad');
    const previous = ytext.toString();
    // Apply only the changed span; replacing the whole document loses CRDT intent.
    let start = 0;
    while (start < previous.length && start < value.length && previous[start] === value[start])
      start++;
    let end = 0;
    while (
      end < previous.length - start &&
      end < value.length - start &&
      previous[previous.length - 1 - end] === value[value.length - 1 - end]
    )
      end++;
    ydoc.transact(() => {
      ytext.delete(start, previous.length - start - end);
      ytext.insert(start, value.slice(start, value.length - end));
    });
  }
  async function act(path: string, method: string, body?: unknown) {
    try {
      await api(path, method, body);
      await refresh();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BETTER WHEN WE BUILD TOGETHER</span>
          <h1>A shared train of thought.</h1>
          <p>Live notes, small tasks, and a clear way to ask for what you need.</p>
        </div>
        <div className="collab-presence">
          <Focus size={16} />
          <select
            aria-label="Your presence"
            value={data?.presence.find((p) => p.deviceId === state.me.id)?.status || 'available'}
            onChange={(e) => act('/presence', 'PATCH', { status: e.target.value })}
          >
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="focus">Focus mode</option>
            <option value="away">Away</option>
          </select>
        </div>
      </div>
      <div className="collab-people">
        {state.devices.map((d) => (
          <span key={d.id}>
            <span className={`status-dot ${!d.online ? 'offline' : ''}`} />
            {d.name}
            <small>{data?.presence.find((p) => p.deviceId === d.id)?.status || 'available'}</small>
          </span>
        ))}
      </div>
      <div className="collab-columns">
        <section className="panel scratchpad">
          <SectionHeading
            title="The shared scratchpad"
            detail="A live text note. Edits merge when this browser reconnects."
            action={<Badge>{connected ? 'Live sync' : 'Saved on this device'}</Badge>}
          />
          <textarea
            aria-label="Shared scratchpad"
            value={scratch}
            maxLength={16000}
            onChange={(e) => edit(e.target.value)}
            readOnly={!canEdit}
            placeholder="Start a thought. Someone else can take it further…"
          />
          <div className="scratchpad-footer">
            <span>
              <Users size={13} />{' '}
              {canEdit ? 'Everyone with chat access can edit' : 'Read-only view'}
            </span>
            <small>{scratch.length.toLocaleString()} / 16,000</small>
          </div>
          <p className="field-hint">
            This note is also stored in this browser for offline editing. Avoid passwords and
            secrets.
          </p>
        </section>
        <section className="panel">
          <SectionHeading
            title="Could you send me…"
            detail="A request, never automatic access to someone’s files."
            action={
              <button
                className="icon-button"
                aria-label="Request a file"
                onClick={() => setModal('request')}
                disabled={!canWrite || !state.me.permissions.files}
              >
                <Plus size={18} />
              </button>
            }
          />
          {data?.requests.length ? (
            <div className="file-requests">
              {data.requests.map((r) => (
                <article key={r.id}>
                  <div>
                    <Badge tone={r.status === 'pending' ? 'amber' : 'green'}>{r.status}</Badge>
                    <small>{ago(r.createdAt)}</small>
                  </div>
                  <p>{r.text}</p>
                  <small>
                    {nameOf(r.deviceId)} → {nameOf(r.target)}
                  </small>
                  {r.status === 'pending' && r.target === state.me.id && (
                    <div className="request-actions">
                      <button
                        className="button secondary compact"
                        onClick={() => onSendFile(r.deviceId)}
                      >
                        <Download size={13} /> Choose file
                      </button>
                      <button
                        className="button-text"
                        onClick={() =>
                          act(`/file-requests/${r.id}`, 'PATCH', { status: 'fulfilled' })
                        }
                      >
                        Mark sent
                      </button>
                      <button
                        className="button-text destructive"
                        onClick={() =>
                          act(`/file-requests/${r.id}`, 'PATCH', { status: 'declined' })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={FileQuestion}
              title="Ask, then share."
              text="Request a file from a paired device. They choose exactly what to send."
            />
          )}
        </section>
      </div>
      <section className="task-section">
        <SectionHeading
          title="Small steps, shared progress"
          detail="Tasks sync while connected. Conflicting status changes are flagged."
          action={
            <button
              className="button secondary compact"
              onClick={() => setModal('task')}
              disabled={!canEdit}
            >
              <Plus size={15} /> Add task
            </button>
          }
        />
        <div className="task-board">
          {(['todo', 'doing', 'done'] as const).map((status) => (
            <div className="task-column" key={status}>
              <h3>
                <span className={`task-status ${status}`} />
                {status === 'todo' ? 'To do' : status === 'doing' ? 'In progress' : 'Done'}
                <span>{data?.tasks.filter((t) => t.status === status).length || 0}</span>
              </h3>
              {data?.tasks
                .filter((t) => t.status === status)
                .map((task) => (
                  <article className="task-card" key={task.id}>
                    <p>{task.text}</p>
                    <div className="task-meta">
                      <span>{nameOf(task.assignee)}</span>
                      {task.due && <time>{task.due}</time>}
                    </div>
                    <div className="task-actions">
                      <select
                        aria-label={`Status of ${task.text}`}
                        value={task.status}
                        disabled={!canEdit}
                        onChange={(e) =>
                          act(`/tasks/${task.id}`, 'PATCH', {
                            status: e.target.value,
                            version: task.version,
                          })
                        }
                      >
                        <option value="todo">To do</option>
                        <option value="doing">In progress</option>
                        <option value="done">Done</option>
                      </select>
                      {(task.deviceId === state.me.id || state.me.role === 'owner') && (
                        <button
                          className="icon-button"
                          aria-label={`Delete task ${task.text}`}
                          onClick={() => act(`/tasks/${task.id}`, 'DELETE')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          ))}
        </div>
      </section>
      {modal && (
        <Modal
          title={modal === 'task' ? 'One small next step' : 'Ask for a file'}
          onClose={() => setModal(null)}
        >
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const ok =
                modal === 'task'
                  ? await act('/tasks', 'POST', {
                      text: form.get('text'),
                      assignee: form.get('device') || null,
                      due: form.get('due') || null,
                    })
                  : await act('/file-requests', 'POST', {
                      text: form.get('text'),
                      target: form.get('device'),
                    });
              if (ok) setModal(null);
            }}
          >
            <label>
              {modal === 'task' ? 'What needs doing?' : 'Which file do you need?'}
              <input name="text" autoFocus required maxLength={300} />
            </label>
            <label>
              {modal === 'task' ? 'Assign to' : 'Ask this device'}
              <select name="device" required={modal === 'request'}>
                {modal === 'task' && <option value="">Unassigned</option>}
                {state.devices
                  .filter(
                    (d) =>
                      modal === 'task' ||
                      (d.id !== state.me.id && !['observer', 'guest'].includes(d.role)),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            {modal === 'task' && (
              <label>
                Due date (optional)
                <input name="due" type="date" />
              </label>
            )}
            <button className="button primary">
              {modal === 'task' ? 'Add task' : 'Send request'}
              <Plus size={15} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
