import { useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { api } from './api';
import type { State, Transfer } from './types';

export type Upload = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'hashing' | 'uploading' | 'paused' | 'error';
  error?: string;
};
export function useUploads(
  state: State | null,
  refresh: () => Promise<void>,
  notify: (text: string, error?: boolean) => void,
) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const tasks = useRef(
    new Map<
      string,
      { file: File; paused: boolean; running: boolean; target: string | null; transfer?: Transfer }
    >(),
  );
  const patch = (id: string, update: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...update } : u)));
  async function run(taskId: string) {
    const task = tasks.current.get(taskId);
    if (!task || task.running || !state) return;
    task.running = true;
    task.paused = false;
    try {
      if (!task.transfer) {
        patch(taskId, { status: 'hashing' });
        const hasher = sha256.create();
        for (let offset = 0; offset < task.file.size; offset += state.limits.chunkSize) {
          hasher.update(
            new Uint8Array(
              await task.file.slice(offset, offset + state.limits.chunkSize).arrayBuffer(),
            ),
          );
          patch(taskId, {
            progress: task.file.size
              ? ((offset + state.limits.chunkSize) / task.file.size) * 100
              : 100,
          });
        }
        task.transfer = await api<Transfer>('/transfers', 'POST', {
          name: task.file.name,
          size: task.file.size,
          sha256: bytesToHex(hasher.digest()),
          target: task.target,
        });
      } else {
        const latest = await api<State>('/state');
        const transfer = latest.transfers.find((t) => t.id === task.transfer!.id);
        if (!transfer) throw new Error('This transfer was removed. Select the file again.');
        task.transfer = transfer;
      }
      let offset = task.transfer.offset;
      patch(taskId, {
        status: 'uploading',
        progress: task.file.size ? (offset / task.file.size) * 100 : 100,
      });
      while (offset < task.file.size) {
        if (task.paused) {
          patch(taskId, { status: 'paused' });
          return;
        }
        const chunk = new Uint8Array(
          await task.file.slice(offset, offset + state.limits.chunkSize).arrayBuffer(),
        );
        const response = await fetch(`/api/transfers/${task.transfer.id}/chunk`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Omni-Client': '1',
            'X-Offset': String(offset),
            'X-Chunk-Sha256': bytesToHex(sha256(chunk)),
          },
          body: chunk,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Upload interrupted. Retry to resume.');
        offset = result.offset;
        task.transfer.offset = offset;
        patch(taskId, { progress: (offset / task.file.size) * 100 });
      }
      await api(`/transfers/${task.transfer.id}/complete`, 'POST', {});
      setUploads((list) => list.filter((u) => u.id !== taskId));
      tasks.current.delete(taskId);
      notify(`${task.file.name} is ready to download.`);
      await refresh();
    } catch (e) {
      patch(taskId, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' });
      notify(e instanceof Error ? e.message : 'Upload failed.', true);
    } finally {
      task.running = false;
    }
  }
  async function add(files: FileList | File[], target: string | null) {
    if (!state?.me.permissions.files || ['guest', 'observer'].includes(state.me.role)) {
      notify('File sharing is not enabled for this device.', true);
      return;
    }
    for (const file of Array.from(files)) {
      if (file.size > state.limits.maxFileSize) {
        notify(`${file.name} exceeds the 1 GB file limit.`, true);
        continue;
      }
      const taskId = crypto.randomUUID();
      tasks.current.set(taskId, { file, paused: false, running: false, target });
      setUploads((list) => [
        ...list,
        { id: taskId, name: file.name, size: file.size, progress: 0, status: 'hashing' },
      ]);
      // Serial files, bounded-memory chunks. The page remains interactive.
      await run(taskId);
    }
  }
  function pause(id: string) {
    const task = tasks.current.get(id);
    if (task) task.paused = true;
  }
  async function cancel(id: string) {
    const task = tasks.current.get(id);
    if (!task) return;
    task.paused = true;
    if (task.running) {
      notify('Pausing the current chunk. Press remove after it pauses.');
      return;
    }
    try {
      if (task.transfer) await api(`/transfers/${task.transfer.id}`, 'DELETE');
      tasks.current.delete(id);
      setUploads((list) => list.filter((u) => u.id !== id));
      await refresh();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  return { uploads, add, pause, resume: run, cancel };
}
