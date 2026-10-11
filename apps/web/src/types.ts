export type Capability = 'clipboard' | 'files' | 'chat' | 'notifications' | 'screen';
export type Permissions = Record<Capability, boolean>;
export type Device = {
  id: string;
  name: string;
  platform: string;
  role: 'owner' | 'member' | 'guest' | 'observer';
  permissions: Permissions;
  online: boolean;
  createdAt: number;
  lastSeen: number;
};
export type Clip = {
  id: string;
  deviceId: string;
  text: string;
  target: string | null;
  pinned: number;
  createdAt: number;
};
export type Transfer = {
  id: string;
  deviceId: string;
  target: string | null;
  name: string;
  size: number;
  sha256: string;
  offset: number;
  status: 'uploading' | 'ready' | 'cancelled';
  createdAt: number;
};
export type Message = { id: string; deviceId: string; text: string; createdAt: number };
export type Note = Message & { color: 'sage' | 'peach' | 'lavender' };
export type Notice = {
  id: string;
  deviceId: string;
  title: string;
  body: string;
  createdAt: number;
};
export type Activity = {
  id: string;
  deviceId: string;
  action: string;
  detail: string;
  createdAt: number;
  hash: string;
};
export type State = {
  me: Device;
  focusMode: boolean;
  space: { name: string; retentionDays: number };
  devices: Device[];
  clips: Clip[];
  transfers: Transfer[];
  messages: Message[];
  notes: Note[];
  notifications: Notice[];
  activity: Activity[];
  limits: { chunkSize: number; maxFileSize: number; maxStorage: number; usedStorage: number };
  transport: { secure: boolean; mode: string; endToEndEncrypted: boolean };
};
export type Page =
  | 'overview'
  | 'devices'
  | 'clipboard'
  | 'transfers'
  | 'screen'
  | 'chat'
  | 'activity'
  | 'settings'
  | 'collaboration';
